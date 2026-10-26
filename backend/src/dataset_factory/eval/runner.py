"""eval 打分运行器：一次打分运行的执行体（持锁、定计划、逐条调用、落三件套、发事件）。

形态与 ``runs.BatchRunner`` 同构（实例制、注入式 completer 工厂、事件多播、协作
停止、启动失败收口），不跨域 import——两域运行记录字段差异大，抽共享助手留实现
期裁量（tdd「二、模块划分」）。

运行组织（PRD「评测主流程」）：**单相全自动**——维度评分全量 → pairwise 按配置
范围（全量／对数上限子采样）与双序策略（全量双序／随机抽验／单序随机左右）。
**随机抽检题单在 judge 前生成**（不依赖 judge，人工可先打），**定向筛查题单在
judge 之后**按判分挑选（幻觉判定优先全收＋维度分相对分位从低到高／胜负分歧取
并集，缺口不补），两份题单落 ``samples.json``（随运行留痕——固定复用开关的
数据基础，tdd「三、数据与存储」）。

锁模型（用户裁乙）：打分运行持 ``.dsf/eval/run.lock``，与打标的 ``run.lock``
互不阻塞；同一工作目录同时只跑一个打分运行。
"""

from __future__ import annotations

import json
import logging
import os
import platform
import random
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol, cast

from .._clock import now_iso, now_log_stamp
from .._fs import atomic_write_text
from ..llm import (
    VIDEO_MIME_BY_SUFFIX,
    Completer,
    EndpointConfig,
    ImagePart,
    LLMConnectionError,
    LLMError,
    LLMRateLimitError,
    LLMServerError,
    LLMTimeoutError,
    VideoPart,
    build_completer,
    read_config,
)
from ..strategies import (
    BatchNotFoundError,
    StrategyNotFoundError,
    missing_refs,
    read_snapshot,
)
from ..strategies.snapshot import build_snapshot, tool_version
from ..strategies.store import get_strategy
from ..workdir import (
    RunLock,
    RunOccupiedError,
    WorkdirStore,
    product_filename,
    product_has_content,
    registered_origins,
    scan_assets,
)
from .batches import get_eval_batch, read_eval_config, validate_references
from .config import (
    DUAL_FULL,
    DUAL_NONE,
    DUAL_SAMPLED,
    KIND_BINARY,
    KIND_SCORE5,
    EvalBatchConfig,
)
from .errors import (
    EvalConfigError,
    EvalError,
    EvalJudgeFormatError,
    EvalRunOccupiedError,
)
from .judge import (
    JudgeCaller,
    build_dimension_messages,
    build_pairwise_messages,
    dimension_response_schema,
    pairwise_response_schema,
    parse_dimension_output,
    parse_pairwise_output,
)
from .report import build_report
from .store import EvalStore

__all__ = [
    "RUN_STATUS_COMPLETED",
    "RUN_STATUS_FAILED",
    "RUN_STATUS_INTERRUPTED",
    "RUN_STATUS_RUNNING",
    "EvalEvent",
    "EvalRunner",
    "ItemScoredEvent",
    "RunFinishedEvent",
    "RunReport",
    "RunStartedEvent",
]

logger = logging.getLogger(__name__)

RUN_STATUS_RUNNING = "running"
RUN_STATUS_COMPLETED = "completed"
RUN_STATUS_INTERRUPTED = "interrupted"
RUN_STATUS_FAILED = "failed"

#: 首次尝试 + 最多自动重试 3 次（与打标跑批同一档）。
_MAX_AUTO_ATTEMPTS = 4
_BACKOFF_BASE_SECONDS = 1.0
_JITTER_RATIO = 0.2

_EVAL_OCCUPIED_DETAIL = (
    "该工作目录正被另一个打分（评测）运行占用（评测与打标可并行、评测之间互斥）；"
    "等它结束或停止后再试。"
)


class EvalEvent(Protocol):
    """打分运行业务事件的共同形状（kind + 载荷；SSE 帧名与跑批同构）。"""

    @property
    def kind(self) -> str:
        """帧名（run-started / item-updated / run-finished）。"""
        ...

    def to_payload(self) -> dict[str, Any]:
        """SSE 载荷。"""
        ...


@dataclass
class RunStartedEvent:
    """run-started 帧：运行受理后的起点（含计划调用数）。"""

    run_id: str
    seq: int
    planned: int
    started_at: str

    @property
    def kind(self) -> str:
        """帧名。"""
        return "run-started"

    def to_payload(self) -> dict[str, Any]:
        """载荷。"""
        return {
            "run_id": self.run_id,
            "batch": f"e{self.seq}",
            "planned": self.planned,
            "started_at": self.started_at,
        }


@dataclass
class ItemScoredEvent:
    """item-updated 帧：一次 judge 调用出终态（维度评分或对局）。"""

    run_id: str
    seq: int
    phase: str  # dimension / pair
    item: str
    judge: str
    status: str

    @property
    def kind(self) -> str:
        """帧名。"""
        return "item-updated"

    def to_payload(self) -> dict[str, Any]:
        """载荷。"""
        return {
            "run_id": self.run_id,
            "batch": f"e{self.seq}",
            "phase": self.phase,
            "item": self.item,
            "judge": self.judge,
            "status": self.status,
        }


@dataclass
class RunFinishedEvent:
    """run-finished 帧：运行终态（completed / interrupted / failed）。"""

    run_id: str
    seq: int
    status: str
    counters: dict[str, int]
    error: str | None = None

    @property
    def kind(self) -> str:
        """帧名。"""
        return "run-finished"

    def to_payload(self) -> dict[str, Any]:
        """载荷。"""
        payload: dict[str, Any] = {
            "run_id": self.run_id,
            "batch": f"e{self.seq}",
            "status": self.status,
            "counters": self.counters,
        }
        if self.error is not None:
            payload["error"] = self.error
        return payload


@dataclass
class RunReport:
    """一次打分运行的最终报告（run() 的返回值）。"""

    run_id: str
    status: str
    counters: dict[str, int]
    run_dir: Path


@dataclass
class _JudgePlan:
    """一名裁判的运行期装配：提示词、技能全文、调用器与策略快照（存档用）。"""

    judge_id: str
    prompt_body: str
    skill_texts: list[str]
    caller: JudgeCaller
    snapshot: dict[str, object]


@dataclass
class _ItemPlan:
    """一个素材的评测计划：媒体路径＋各批次 caption（有产物的才进）。"""

    stem: str
    asset_path: Path
    captions: dict[int, str] = field(default_factory=lambda: dict[int, str]())
    reference: str | None = None

    def caption_for(self, batch: int, benchmark: int | None) -> str:
        """取某批次在该素材上的文本（被测产物或基准参照）。"""
        if batch in self.captions:
            return self.captions[batch]
        if batch == benchmark and self.reference is not None:
            return self.reference
        return ""


@dataclass
class _PairPlan:
    """一局对比：A/B 批次与是否补第二序（双序）。"""

    stem: str
    a_batch: int
    b_batch: int
    dual: bool


def _backoff_seconds(attempt: int, rng: random.Random) -> float:
    """第 attempt 次尝试失败后的退避秒数：1s / 2s / 4s 乘 ±20% 随机抖动。"""
    base = _BACKOFF_BASE_SECONDS * (2 ** (attempt - 1))
    return base * rng.uniform(1 - _JITTER_RATIO, 1 + _JITTER_RATIO)


def _new_run_id(runs_dir: Path) -> str:
    """分配运行目录名：UTC 时间戳定宽（字典序即时间序），撞名加序号。"""
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    candidate = stamp
    suffix = 1
    while (runs_dir / candidate).exists():
        candidate = f"{stamp}-{suffix}"
        suffix += 1
    return candidate


def _append_jsonl(path: Path, record: dict[str, object]) -> None:
    """追加一行 JSON 流水（崩溃安全：残缺尾行在下一次追加前截去，fsync 落盘）。"""
    line = (json.dumps(record, ensure_ascii=False) + "\n").encode("utf-8")
    with path.open("a+b") as handle:
        handle.seek(0)
        raw = handle.read()
        if raw and not raw.endswith(b"\n"):
            handle.truncate(raw.rfind(b"\n") + 1)
        handle.seek(0, os.SEEK_END)
        handle.write(line)
        handle.flush()
        os.fsync(handle.fileno())


def _reason_code(exc: LLMError) -> tuple[str, bool]:
    """llm 异常 → (原因码, 可否自动重试)；口径对齐打标跑批的两类清单。"""
    if isinstance(exc, LLMRateLimitError):
        return "rate-limit", True
    if isinstance(exc, LLMTimeoutError):
        return "timeout", True
    if isinstance(exc, LLMConnectionError):
        return "network", True
    if isinstance(exc, LLMServerError):
        return "5xx", True
    return "llm-error", False


def _read_caption(workdir: Path, batch: int, stem: str) -> str | None:
    """读一个批次在该素材上的 caption 产物；无产物或空白返回 None。"""
    product = workdir / product_filename(batch, stem)
    if not product_has_content(product):
        return None
    try:
        return product.read_text(encoding="utf-8").strip()
    except OSError:
        return None


def _build_media_part(asset_path: Path) -> ImagePart | VideoPart:
    """按扩展名把素材读成媒体块（图片走 ImagePart，视频走 VideoPart 默认抽帧）。"""
    data = asset_path.read_bytes()
    suffix = asset_path.suffix.lower()
    if suffix in VIDEO_MIME_BY_SUFFIX:
        return VideoPart(data, mime=VIDEO_MIME_BY_SUFFIX[suffix], fps=2, max_frames=16)
    return ImagePart(data)


class EvalRunner:
    """一个打分批次的执行器：持锁、定计划、逐条调 judge、落三件套、发事件。

    一次运行对应一个实例；同一工作目录同一时刻只允许一个**打分**运行（eval
    运行锁保证；与打标运行互不阻塞——用户裁乙）。completer 经工厂注入——测试
    注入假工厂即可离线跑全流程。
    """

    def __init__(
        self,
        workdir: Path,
        seq: int,
        *,
        trigger: str = "web",
        completer_factory: Callable[[EndpointConfig], Completer] | None = None,
        sleeper: Callable[[float], None] | None = None,
        rng: random.Random | None = None,
    ) -> None:
        """绑定工作目录与打分批次序号。

        Args:
            workdir: 工作目录路径（须已登记）。
            seq: 打分批次序号（eN 的 N）。
            trigger: web / cli（出身记录）。
            completer_factory: 端点配置 → Completer 的装配工厂；缺省用
                ``llm.build_completer``（裁判温度 0 由裁判端点配置自带）。
            sleeper: 退避等待函数（注入替代 time.sleep，测试不打真盹）。
            rng: 随机源（抽样 / 双序 / 左右随机）；测试注入定种子实例。
        """
        self._workdir = workdir
        self._seq = seq
        self._trigger = trigger
        self._factory = completer_factory or build_completer
        self._sleep = sleeper if sleeper is not None else time.sleep
        # S311：抽样与双序随机不是加密用途。
        self._rng = rng if rng is not None else random.Random()  # noqa: S311
        self._stop_event = threading.Event()
        self._subscribers: list[Callable[[EvalEvent], None]] = []
        self._subscriber_guard = threading.Lock()
        self._finished_event: RunFinishedEvent | None = None
        store = EvalStore(workdir)
        self._store = store
        self._run_id = _new_run_id(store.runs_dir)
        self._status = RUN_STATUS_RUNNING
        self._error: str | None = None
        self._counters = {
            "planned": 0,
            "attempted": 0,
            "succeeded": 0,
            "failed": 0,
            "skipped": 0,
        }

    # -- 进度快照与跨线程控制（供入口层） ------------------------------------

    def snapshot(self) -> dict[str, Any]:
        """当前运行进度快照：run_id / batch / status / counters。"""
        return {
            "run_id": self._run_id,
            "batch": f"e{self._seq}",
            "status": self._status,
            "counters": dict(self._counters),
            "error": self._error,
        }

    def stop(self) -> None:
        """请求停止：当前调用在下一个安全点（调用边界 / 退避后）停下。"""
        self._stop_event.set()

    def subscribe(self, callback: Callable[[EvalEvent], None]) -> Callable[[], None]:
        """订阅业务事件（多播），返回退订函数；终态与订阅原子交接。"""
        with self._subscriber_guard:
            finished = self._finished_event
            if finished is None:
                self._subscribers.append(callback)
        if finished is not None:
            self._emit_to(callback, finished)

        def _unsubscribe() -> None:
            with self._subscriber_guard:
                if callback in self._subscribers:
                    self._subscribers.remove(callback)

        return _unsubscribe

    def _emit(self, event: EvalEvent) -> None:
        """向全部订阅者多播一条事件（终态事件先落 ``_finished_event`` 再广播）。"""
        if isinstance(event, RunFinishedEvent):
            with self._subscriber_guard:
                self._finished_event = event
                subscribers = list(self._subscribers)
                self._subscribers.clear()
        else:
            with self._subscriber_guard:
                subscribers = list(self._subscribers)
        for callback in subscribers:
            self._emit_to(callback, event)

    def _emit_to(self, callback: Callable[[EvalEvent], None], event: EvalEvent) -> None:
        """单发一条事件；回调异常只记日志、绝不中断运行。"""
        try:
            callback(event)
        except Exception:
            logger.warning("打分运行事件订阅者回调异常（已忽略）", exc_info=True)

    # -- 主流程 ---------------------------------------------------------------

    def run(self) -> RunReport:
        """执行一次打分运行（阻塞到结束 / 停止），返回最终报告。

        启动失败的异常（引用不成立、跨进程锁被占等）在此收口：状态置 failed、
        错误进快照、已落盘的 run.json 尽力改成 failed 终态、发 failed 终态事件后
        原样重抛。

        Raises:
            EvalConfigError: 裁判策略被删或其引用缺失（引用不成立运行直接失败）。
            EvalRunOccupiedError: 该工作目录已有打分运行在跑（跨进程锁占用）。
            EvalError: 打分批次或配置不存在 / 损坏。
        """
        self._status = RUN_STATUS_RUNNING
        try:
            return self._run()
        except Exception as exc:
            self._status = RUN_STATUS_FAILED
            self._error = str(exc)
            self._persist_failed_status()
            self._emit(
                RunFinishedEvent(
                    run_id=self._run_id,
                    seq=self._seq,
                    status=RUN_STATUS_FAILED,
                    counters=dict(self._counters),
                    error=self._error,
                )
            )
            raise

    def _persist_failed_status(self) -> None:
        """失败路径尽力把 run.json 改成 failed 终态（写失败只告警，不掩盖原异常）。

        运行记录停在 running 会让外部把它当成「还在跑」（current / 历史回读都靠
        这个字段判终态）。run 目录还没建起来（启动校验就失败）时无事可做。
        """
        path = self._store.runs_dir / self._run_id / "run.json"
        if not path.is_file():
            return
        try:
            loaded: object = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            logger.warning(
                "打分运行的失败终态未能写回 run.json（读不出来）：run=%s",
                self._run_id,
                exc_info=True,
            )
            return
        if not isinstance(loaded, dict):
            logger.warning(
                "打分运行的失败终态未能写回 run.json（顶层不是对象）：run=%s",
                self._run_id,
            )
            return
        record = cast("dict[str, object]", loaded)
        record["status"] = RUN_STATUS_FAILED
        record["counters"] = dict(self._counters)
        record["error"] = self._error
        record["finished_at"] = now_iso()
        try:
            atomic_write_text(path, json.dumps(record, ensure_ascii=False, indent=2))
        except OSError:
            logger.warning(
                "打分运行的失败终态未能写回 run.json（写不进去）：run=%s",
                self._run_id,
                exc_info=True,
            )

    def _run(self) -> RunReport:
        """抢评测运行锁，**锁内**校验批次与配置（锁外读会与删除竞态）。

        锁外的预检（HTTP 受理 / CLI）只是提前失败；权威判定在锁内：抢到锁之后才
        读批次与配置、跑规则校验与引用校验——否则删除可以在「读过配置」与「抢到
        锁」之间完成，本次运行会为已删的批次建出孤儿运行与报告。
        """
        lock = RunLock(
            self._store.eval_dir,
            occupied_detail=_EVAL_OCCUPIED_DETAIL,
            occupier_role="打分（评测）运行",
        )
        try:
            lock.acquire(
                {
                    "pid": os.getpid(),
                    "started_at": now_iso(),
                    "hostname": platform.node(),
                    "batch": f"e{self._seq}",
                    "run_id": self._run_id,
                }
            )
        except RunOccupiedError as exc:
            # 域边界翻译：本域对外只有 eval-run-occupied，RunOccupiedError 不外泄。
            raise EvalRunOccupiedError(str(exc), occupier=exc.occupier) from exc
        try:
            get_eval_batch(self._workdir, self._seq)
            config = read_eval_config(self._workdir, self._seq)
            config.validate()
            validate_references(self._workdir, config)
            return self._run_locked(config)
        finally:
            lock.release()

    def _resolve_judges(self, config: EvalBatchConfig) -> list[_JudgePlan]:
        """装配裁判：策略现查＋引用健康检查＋全文快照＋调用器。

        Raises:
            EvalConfigError: 任一裁判策略不存在或引用缺失（报清楚，不静默跳过）。
        """
        plans: list[_JudgePlan] = []
        for judge_id in config.judges:
            try:
                entry = get_strategy(judge_id)
            except StrategyNotFoundError as exc:
                raise EvalConfigError(
                    f"裁判策略 {judge_id} 不在策略库中——请改配打分批次后重跑。"
                ) from exc
            problems = missing_refs(entry)
            if problems:
                raise EvalConfigError(
                    f"裁判策略「{entry.name}」引用不成立（"
                    + "；".join(problems)
                    + "）——请先在策略库修复后重跑。"
                )
            snapshot = build_snapshot(
                entry.endpoint_id,
                entry.prompt_id,
                entry.skill_ids,
                built_at=now_iso(),
                source={"strategy_id": judge_id},
            ).to_json()
            prompt = snapshot.get("prompt")
            prompt_body = (
                cast("str", cast("dict[str, object]", prompt).get("body"))
                if isinstance(prompt, dict)
                else ""
            )
            skill_texts = [
                cast("str", cast("dict[str, object]", block).get("body"))
                for block in cast("list[object]", snapshot.get("skills", []))
                if isinstance(block, dict)
            ]
            completer = self._factory(read_config(entry.endpoint_id))
            plans.append(
                _JudgePlan(
                    judge_id=judge_id,
                    prompt_body=prompt_body,
                    skill_texts=skill_texts,
                    caller=JudgeCaller(completer),
                    snapshot=cast("dict[str, object]", snapshot),
                )
            )
        return plans

    def _plan_items(self, config: EvalBatchConfig) -> list[_ItemPlan]:
        """定条目计划：登记素材 ×（各被测批次 / 基准批次的产物 caption）。

        无任何 caption 的素材不参评（没有可评对象）；条目按主干排序（确定性）。
        """
        registered = set(registered_origins(WorkdirStore(self._workdir)))
        assets = scan_assets(self._workdir)
        plans: list[_ItemPlan] = []
        for stem, asset_path in sorted(assets.items()):
            if asset_path.name not in registered:
                continue
            captions: dict[int, str] = {}
            for batch in config.candidates:
                caption = _read_caption(self._workdir, batch, stem)
                if caption is not None:
                    captions[batch] = caption
            if not captions:
                continue
            plans.append(
                _ItemPlan(
                    stem=stem,
                    asset_path=asset_path,
                    captions=captions,
                    reference=(
                        _read_caption(self._workdir, config.benchmark, stem)
                        if config.benchmark is not None
                        else None
                    ),
                )
            )
        return plans

    def _plan_pairs(
        self, config: EvalBatchConfig, items: list[_ItemPlan]
    ) -> list[_PairPlan]:
        """定对局计划：对战池两两组合 → 全局对数上限子采样 → 双序与左右决策。"""
        pairs: list[_PairPlan] = []
        for item in items:
            pool = sorted(
                set(item.captions)
                | (
                    {config.benchmark}
                    if config.benchmark is not None and item.reference is not None
                    else set()
                )
            )
            for index, a_batch in enumerate(pool):
                for b_batch in pool[index + 1 :]:
                    pairs.append(
                        _PairPlan(
                            stem=item.stem, a_batch=a_batch, b_batch=b_batch, dual=False
                        )
                    )
        settings = config.pairwise_settings
        limit = settings.limit if settings is not None else None
        if limit is not None and len(pairs) > limit:
            pairs = sorted(
                self._rng.sample(pairs, limit),
                key=lambda pair: (pair.stem, pair.a_batch, pair.b_batch),
            )
        dual_order = settings.dual_order if settings is not None else DUAL_NONE
        for pair in pairs:
            if dual_order == DUAL_FULL:
                pair.dual = True
            elif dual_order == DUAL_SAMPLED:
                ratio = settings.dual_order_ratio or 0 if settings else 0
                pair.dual = self._rng.randrange(100) < ratio
                if not pair.dual and self._rng.random() < 0.5:
                    # 没抽中双序的对也是单序随机左右（PRD：其余对单序、左右随机）。
                    pair.a_batch, pair.b_batch = pair.b_batch, pair.a_batch
            elif self._rng.random() < 0.5:
                # 不双序·单序随机左右：换位一次即「A/B 随机」。
                pair.a_batch, pair.b_batch = pair.b_batch, pair.a_batch
        return pairs

    def _caption_pair(
        self, item: _ItemPlan, a_batch: int, b_batch: int, benchmark: int | None
    ) -> tuple[str, str]:
        """取一局双方的文本（被测产物或基准参照）。"""
        return (
            item.caption_for(a_batch, benchmark),
            item.caption_for(b_batch, benchmark),
        )

    def _candidate_snapshots(self, config: EvalBatchConfig) -> list[dict[str, object]]:
        """各被测批次的策略快照（运行记录里的复现数据；读不出就失败，不留缺口）。

        Raises:
            EvalConfigError: 被测批次的快照缺失或损坏（可复现性不允许静默留空）。
        """
        snapshots: list[dict[str, object]] = []
        for seq in config.candidates:
            try:
                snapshot = read_snapshot(self._workdir, seq).to_json()
            except (BatchNotFoundError, StrategyNotFoundError) as exc:
                raise EvalConfigError(
                    f"被测批次 s{seq} 的策略快照读不出来（{exc}）——"
                    "请检查该批次与快照文件后重跑。"
                ) from exc
            snapshots.append({"batch": f"s{seq}", "snapshot": snapshot})
        return snapshots

    def _run_locked(self, config: EvalBatchConfig) -> RunReport:
        """持锁执行体：装配裁判、定计划、落 run.json、逐调用执行、收尾。"""
        judges = self._resolve_judges(config)
        items = self._plan_items(config)
        pairs = self._plan_pairs(config, items) if config.pairwise else []
        dimension_calls = (
            sum(len(item.captions) for item in items) * len(judges)
            if config.dimension_scoring
            else 0
        )
        pair_calls = sum(1 + int(pair.dual) for pair in pairs) * len(judges)
        self._counters["planned"] = dimension_calls + pair_calls
        # 复现数据先取：快照读不出来就在建运行目录之前失败（不留空壳目录）。
        candidate_snapshots = self._candidate_snapshots(config)
        run_dir = self._store.runs_dir / self._run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        started_at = now_iso()
        run_record: dict[str, object] = {
            "run_id": self._run_id,
            "batch": f"e{self._seq}",
            "config": config.to_json(),
            "judges": [
                {"strategy_id": plan.judge_id, "snapshot": plan.snapshot}
                for plan in judges
            ],
            # 复现数据：被测批次的策略快照（配置与裁判在上面／这里）。人工分由
            # 报告生成时统一读取，三层消费同一份快照，不在运行记录里再存一份。
            "candidates": candidate_snapshots,
            "trigger": self._trigger,
            "dsf_version": tool_version(),
            "counters": dict(self._counters),
            "pairs": {
                "pairs": len(pairs),
                "dual_pairs": sum(1 for pair in pairs if pair.dual),
            },
            "status": RUN_STATUS_RUNNING,
            "started_at": started_at,
        }
        atomic_write_text(
            run_dir / "run.json",
            json.dumps(run_record, ensure_ascii=False, indent=2),
        )
        log_lines = [
            f"[{now_log_stamp()}] 打分运行 {self._run_id} 启动：批次 e{self._seq}、"
            f"条目 {len(items)}、计划调用 {self._counters['planned']}"
            f"（维度 {dimension_calls}＋对局 {pair_calls}）、裁判 {len(judges)} 名。"
        ]
        # 随机抽检题单在 judge 前生成（不依赖 judge；人工可先打、可与 judge 并行）。
        random_sample = self._pick_random(config, items)
        samples: dict[str, object] = {"random": random_sample, "targeted": None}
        atomic_write_text(
            run_dir / "samples.json",
            json.dumps(samples, ensure_ascii=False, indent=2),
        )
        self._emit(
            RunStartedEvent(
                run_id=self._run_id,
                seq=self._seq,
                planned=self._counters["planned"],
                started_at=started_at,
            )
        )

        dimension_rows: list[dict[str, object]] = []
        pair_rows: list[dict[str, object]] = []
        skipped_stems: list[str] = []
        scores_path = run_dir / "scores.jsonl"
        pairs_path = run_dir / "pairs.jsonl"
        items_by_stem = {item.stem: item for item in items}

        if config.dimension_scoring:
            for item in items:
                if self._stop_event.is_set():
                    break
                try:
                    media = _build_media_part(item.asset_path)
                except OSError as exc:
                    self._counters["skipped"] += len(item.captions) * len(judges)
                    skipped_stems.append(item.stem)
                    _append_jsonl(
                        scores_path,
                        {
                            "kind": "skipped-item",
                            "item": item.stem,
                            "reason_code": "asset-unreadable",
                            "message": " ".join(str(exc).split()),
                        },
                    )
                    continue
                for batch in sorted(item.captions):
                    for judge in judges:
                        if self._stop_event.is_set():
                            break
                        outcome = self._call_with_retry(
                            lambda judge=judge, batch=batch, media=media, item=item: (
                                judge.caller.call(
                                    build_dimension_messages(
                                        prompt_body=judge.prompt_body,
                                        skill_texts=judge.skill_texts,
                                        media=media,
                                        candidate_caption=item.captions[batch],
                                        reference_caption=item.reference,
                                    ),
                                    schema=dimension_response_schema(config.dimensions),
                                    schema_name="dimension_verdict",
                                    parse=lambda raw, dims=config.dimensions: (
                                        parse_dimension_output(raw, dims)
                                    ),
                                )
                            )
                        )
                        if outcome is None:
                            continue  # 停止未出终态：不写终态行，下次重跑重算
                        self._record(
                            scores_path,
                            "dimension",
                            judge,
                            {"item": item.stem, "batch": batch},
                            outcome,
                            dimension_rows,
                        )
                if self._stop_event.is_set():
                    break

        if config.pairwise:
            for pair in pairs:
                if self._stop_event.is_set():
                    break
                item = items_by_stem[pair.stem]
                try:
                    media = _build_media_part(item.asset_path)
                except OSError:
                    self._counters["skipped"] += (1 + int(pair.dual)) * len(judges)
                    continue
                for judge in judges:
                    orders = [(pair.a_batch, pair.b_batch)]
                    if pair.dual:
                        orders.append((pair.b_batch, pair.a_batch))
                    for a_batch, b_batch in orders:
                        if self._stop_event.is_set():
                            break
                        caption_a, caption_b = self._caption_pair(
                            item, a_batch, b_batch, config.benchmark
                        )
                        outcome = self._call_with_retry(
                            lambda judge=judge, a=a_batch, b=b_batch, ca=caption_a, cb=caption_b, media=media, item=item: (
                                judge.caller.call(
                                    build_pairwise_messages(
                                        prompt_body=judge.prompt_body,
                                        skill_texts=judge.skill_texts,
                                        media=media,
                                        caption_a=ca,
                                        caption_b=cb,
                                        reference_caption=item.reference,
                                    ),
                                    schema=pairwise_response_schema(),
                                    schema_name="pairwise_verdict",
                                    parse=parse_pairwise_output,
                                )
                            )
                        )
                        if outcome is None:
                            continue
                        self._record(
                            pairs_path,
                            "pair",
                            judge,
                            {"item": pair.stem, "a_batch": a_batch, "b_batch": b_batch},
                            outcome,
                            pair_rows,
                        )

        interrupted = self._stop_event.is_set()
        # 定向筛查题单在 judge 之后按判分挑选（中断即无判分可依，不出定向名单）。
        if config.human.targeted_enabled and not interrupted:
            samples["targeted"] = self._pick_targeted(config, dimension_rows, pair_rows)
        atomic_write_text(
            run_dir / "samples.json",
            json.dumps(samples, ensure_ascii=False, indent=2),
        )
        status = RUN_STATUS_INTERRUPTED if interrupted else RUN_STATUS_COMPLETED
        run_record["counters"] = dict(self._counters)
        run_record["status"] = status
        run_record["finished_at"] = now_iso()
        if skipped_stems:
            run_record["skipped_items"] = skipped_stems
        atomic_write_text(
            run_dir / "run.json",
            json.dumps(run_record, ensure_ascii=False, indent=2),
        )
        log_lines.append(
            f"[{now_log_stamp()}] 打分运行 {self._run_id} 收尾：{status}，"
            f"成功 {self._counters['succeeded']} / 失败 {self._counters['failed']}"
            f" / 跳过 {self._counters['skipped']}（计划 {self._counters['planned']}）。"
        )
        (run_dir / "run.log").write_text("\n".join(log_lines) + "\n", encoding="utf-8")
        if status == RUN_STATUS_COMPLETED:
            try:
                # 评测完自动出报告（PRD）；报告失败不推翻已完成的运行——
                # 可经 reports 端点按 run_id 重出，评分三件套已完整在盘。
                build_report(self._workdir, self._seq, self._run_id)
            except Exception:
                logger.warning(
                    "报告生成失败（可经 reports 端点重出）：run=%s",
                    self._run_id,
                    exc_info=True,
                )
        self._status = status
        self._emit(
            RunFinishedEvent(
                run_id=self._run_id,
                seq=self._seq,
                status=status,
                counters=dict(self._counters),
            )
        )
        return RunReport(
            run_id=self._run_id,
            status=status,
            counters=dict(self._counters),
            run_dir=run_dir,
        )

    def _record(
        self,
        path: Path,
        phase: str,
        judge: _JudgePlan,
        base: dict[str, object],
        outcome: dict[str, object],
        rows: list[dict[str, object]],
    ) -> None:
        """把一次调用的终态落进对应流水并广播 item-updated、推进计数。"""
        row = {"kind": phase, "judge": judge.judge_id, **base, **outcome}
        _append_jsonl(path, row)
        rows.append(row)
        status = str(outcome.get("status", "failed"))
        self._counters["attempted"] += 1
        self._counters["succeeded" if status == "succeeded" else "failed"] += 1
        self._emit(
            ItemScoredEvent(
                run_id=self._run_id,
                seq=self._seq,
                phase=phase,
                item=str(base.get("item", "")),
                judge=judge.judge_id,
                status=status,
            )
        )

    def _call_with_retry(
        self,
        call: Callable[[], tuple[Any, Any]],
    ) -> dict[str, object] | None:
        """跑一次 judge 调用（可重试类失败按退避自动重试），返回终态 outcome。

        停止请求在调用边界与退避后生效——被停止的调用不写终态行（judge 评分每次
        运行全量重算，无双计问题）。返回 None 表示「因停止未出终态」。
        """
        attempt = 1
        while True:
            if self._stop_event.is_set():
                return None
            started = time.perf_counter()
            try:
                parsed, record = call()
            except EvalJudgeFormatError as exc:
                return {
                    "status": "failed",
                    "reason_code": "judge-format",
                    "message": " ".join(str(exc).split()),
                    "attempt": attempt,
                    "elapsed_ms": int((time.perf_counter() - started) * 1000),
                }
            except EvalError as exc:
                # 装配期配置类问题：重试不会变好，直接记死。
                return {
                    "status": "failed",
                    "reason_code": "config",
                    "message": " ".join(str(exc).split()),
                    "attempt": attempt,
                    "elapsed_ms": int((time.perf_counter() - started) * 1000),
                }
            except LLMError as exc:
                reason_code, retryable = _reason_code(exc)
                if retryable and attempt < _MAX_AUTO_ATTEMPTS:
                    self._sleep(_backoff_seconds(attempt, self._rng))
                    attempt += 1
                    continue
                return {
                    "status": "failed",
                    "reason_code": reason_code,
                    "message": " ".join(str(exc).split()),
                    "attempt": attempt,
                    "elapsed_ms": int((time.perf_counter() - started) * 1000),
                }
            outcome: dict[str, object] = {
                "status": "succeeded",
                "attempt": attempt,
                "elapsed_ms": int((time.perf_counter() - started) * 1000),
                "schema_mode": record.schema_mode,
                "repair_attempts": record.repair_attempts,
                "raw": record.raw_output,
            }
            scores = getattr(parsed, "scores", None)
            if scores is not None:
                outcome["scores"] = scores
            winner = getattr(parsed, "winner", None)
            if winner is not None:
                outcome["winner"] = winner
            reason = getattr(parsed, "reason", None)
            if reason is not None:
                outcome["reason"] = reason
            return outcome

    def _pick_random(
        self, config: EvalBatchConfig, items: list[_ItemPlan]
    ) -> list[str]:
        """生成随机抽检题单：从参评条目均匀抽样（绝对题数，缺口不补）。"""
        if not config.human.random_enabled:
            return []
        universe = sorted(item.stem for item in items)
        count = min(config.human.random_count or 0, len(universe))
        return sorted(self._rng.sample(universe, count)) if count else []

    def _pick_targeted(
        self,
        config: EvalBatchConfig,
        dimension_rows: list[dict[str, object]],
        pair_rows: list[dict[str, object]],
    ) -> dict[str, object]:
        """生成定向筛查题单：按开启的人工活动取并集（专挑样本，推不了总体）。

        挑选依据（judge 判分）与人工活动一一对应：做了**维度人工**才收幻觉与低分
        条目（无幻觉判「有」优先全收，维度均分相对分位从低到高补足）；做了**对比
        人工**才收双序胜负分歧的条目；两个都做就取并集。只勾对比人工时不该把维度
        坏例塞进这份名单（用户不会去评它）。缺口不补、名单缩水。
        """
        dimension_manual = config.human.dimension_manual
        pairwise_manual = config.human.pairwise_manual
        hallucination: set[str] = set()
        score_sum: dict[str, float] = {}
        score_count: dict[str, int] = {}
        binary_names = {
            dim.name for dim in config.dimensions if dim.kind == KIND_BINARY
        }
        score_names = {dim.name for dim in config.dimensions if dim.kind == KIND_SCORE5}
        if dimension_manual:
            for row in dimension_rows:
                if row.get("status") != "succeeded":
                    continue
                item = str(row.get("item", ""))
                scores = row.get("scores")
                if not isinstance(scores, dict):
                    continue
                for name, value in cast("dict[str, object]", scores).items():
                    if name in binary_names and value == "有":
                        hallucination.add(item)
                    if name in score_names and isinstance(value, int):
                        score_sum[item] = score_sum.get(item, 0.0) + value
                        score_count[item] = score_count.get(item, 0) + 1
        divergent: set[str] = set()
        if pairwise_manual:
            verdicts: dict[tuple[object, ...], list[str]] = {}
            for row in pair_rows:
                if row.get("status") != "succeeded":
                    continue
                key = (
                    row.get("item"),
                    frozenset((row.get("a_batch"), row.get("b_batch"))),
                    row.get("judge"),
                )
                verdicts.setdefault(key, []).append(str(row.get("winner", "")))
            divergent = {
                str(key[0])
                for key, winners in verdicts.items()
                if len(winners) >= 2 and len(set(winners)) > 1
            }
        averages = {
            stem: score_sum[stem] / score_count[stem]
            for stem in score_sum
            if score_count[stem]
        }
        low_ranked = sorted(averages, key=lambda stem: (averages[stem], stem))
        wanted = config.human.targeted_count or 0
        picked: list[str] = []
        for stem in sorted(hallucination):
            if len(picked) < wanted:
                picked.append(stem)
        for stem in low_ranked:
            if len(picked) >= wanted:
                break
            if stem not in picked:
                picked.append(stem)
        for stem in sorted(divergent):
            if len(picked) >= wanted:
                break
            if stem not in picked:
                picked.append(stem)
        return {
            "items": picked,
            "basis": {
                "hallucination": sorted(hallucination),
                "low_score": low_ranked,
                "divergent": sorted(divergent),
            },
        }
