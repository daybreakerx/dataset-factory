"""eval 域的打分批次生命周期：新建 / 改名 / 全量改配置 / 删除 / 引用校验。

与打标批次的两个相反口径（PRD）：**配置可反复修改**（评分是「配置 × 数据」的
派生结果，改了保存重跑即重算——PATCH 全量替换配置，不像打标批次组合冻结）；
**不产持久模型产物**，冻结留痕不落配置、落两级快照（运行快照＋报告快照，
见 store 模块头）。序号空间独立：e1、e2…只增不复用（与 sN 同一纪律）。

删除 = 删配置、该批次的运行记录与报告快照（先删附属文件、后提交登记——
与打标批次删除同序，中途失败留下可见现场、可续删）；**人工打分不随删**
（绑素材 × 批次 × 条目 × 标注者、不绑打分批次配置——既定口径）。
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

from .._clock import now_iso
from ..strategies import (
    BatchEntry,
    StrategyNotFoundError,
    get_strategy,
    list_batches,
    missing_refs,
)
from ..workdir import RunOccupiedError, WorkdirStore
from ..workdir.locks import RunLock, workdir_write
from .config import EvalBatchConfig
from .errors import (
    EvalBatchNotFoundError,
    EvalConfigError,
    EvalRunOccupiedError,
)
from .store import EvalBatchEntry, EvalStore, entries_from_state, entries_into_state

__all__ = [
    "DeleteEvalBatchResult",
    "create_eval_batch",
    "delete_eval_batch",
    "get_eval_batch",
    "list_eval_batches",
    "parse_seq",
    "read_eval_config",
    "update_eval_batch",
    "update_eval_config",
    "validate_references",
]

#: 显示名上限（与策略名同尺）。
_MAX_NAME_CHARS = 100

#: 删除打分批次时抢 eval 运行锁的拒绝文案（运行中不许删）。
_DELETE_OCCUPIED_DETAIL = (
    "该工作目录正被一个打分（评测）运行占用，请等它结束或停止后再删除。"
)


def parse_seq(raw: str) -> int:
    """解析路径参数 ``eN`` 为序号（严格 ``e`` + 正整数）；不合法按不存在处理。"""
    if not raw.startswith("e") or not raw[1:].isdigit() or int(raw[1:]) < 1:
        raise EvalBatchNotFoundError(f"打分批次标识「{raw}」不合法——序号形如 e1、e2。")
    return int(raw[1:])


def validate_references(workdir: Path, config: EvalBatchConfig) -> None:
    """引用存在性校验：被测／基准批次在工作目录里、裁判策略在库里且引用健康。

    与 ``EvalBatchConfig.validate`` 分开：那边只看配置自身的规则，这边查盘上
    现状；两处都过才是可保存的配置。裁判策略引用缺失在保存时报（带病运行不如
    早报）；保存后库里被改坏则由运行期兜底（重跑报引用不成立、直接失败——
    既定口径）。

    Raises:
        EvalConfigError: 任一引用不成立（聚合一次报完）。
    """
    problems: list[str] = []
    known: dict[int, BatchEntry] = {entry.seq: entry for entry in list_batches(workdir)}
    missing_candidates = [f"s{seq}" for seq in config.candidates if seq not in known]
    if missing_candidates:
        problems.append(f"被测批次不存在：{'、'.join(missing_candidates)}")
    if config.benchmark is not None and config.benchmark not in known:
        problems.append(f"基准批次 s{config.benchmark} 不存在")
    for judge_id in config.judges:
        try:
            judge = get_strategy(judge_id)
        except StrategyNotFoundError:
            problems.append(f"裁判策略 {judge_id} 不在策略库中")
            continue
        ref_problems = missing_refs(judge)
        if ref_problems:
            problems.append(f"裁判策略「{judge.name}」：" + "；".join(ref_problems))
    if problems:
        raise EvalConfigError("；".join(problems) + "。")


def list_eval_batches(workdir: Path) -> list[EvalBatchEntry]:
    """列出工作目录全部打分批次（按序号升序）。"""
    store = EvalStore(workdir)
    return sorted(entries_from_state(store.read_state()), key=lambda entry: entry.seq)


def get_eval_batch(workdir: Path, seq: int) -> EvalBatchEntry:
    """按序号查打分批次；不存在抛 EvalBatchNotFoundError。"""
    return _require_entry(list_eval_batches(workdir), seq)


def read_eval_config(workdir: Path, seq: int) -> EvalBatchConfig:
    """读某打分批次的配置（先核批次存在，条目在而配置文件坏按损坏报）。"""
    get_eval_batch(workdir, seq)
    return EvalStore(workdir).read_config(seq)


def _require_entry(entries: list[EvalBatchEntry], seq: int) -> EvalBatchEntry:
    """按序号取条目；不存在抛 EvalBatchNotFoundError（读路径与锁内判定共用）。"""
    for entry in entries:
        if entry.seq == seq:
            return entry
    raise EvalBatchNotFoundError(
        f"打分批次 e{seq} 不在工作目录中——可能已被删除，请刷新后重试。",
    )


def _validate_name(name: str) -> str:
    """校验显示名：去首尾空白后非空、不超长；返回规整后的名字。"""
    cleaned = name.strip()
    if not cleaned:
        raise EvalConfigError("打分批次名不能为空——请给它起个名字再保存。")
    if len(cleaned) > _MAX_NAME_CHARS:
        raise EvalConfigError(
            f"打分批次名过长（{len(cleaned)} 字符，上限 {_MAX_NAME_CHARS}）"
            "——请缩短后重试。",
        )
    return cleaned


def _reserve_seq(store: EvalStore) -> int:
    """状态锁内分配并预占下一个序号（只增不复用，防并发建批撞号）。"""

    def mutator(state: dict[str, object]) -> int:
        entries = entries_from_state(state)
        raw = state.get("next_seq")
        if isinstance(raw, int) and not isinstance(raw, bool):
            seq = raw
        else:
            seq = max((entry.seq for entry in entries), default=0) + 1
        state["next_seq"] = seq + 1
        return seq

    return store.mutate_state(mutator)


def _append_entry(store: EvalStore, entry: EvalBatchEntry) -> EvalBatchEntry:
    """状态锁内登记批次条目（调用前配置文件已落盘）。"""

    def mutator(state: dict[str, object]) -> EvalBatchEntry:
        entries = entries_from_state(state)
        entries.append(entry)
        entries_into_state(state, entries)
        return entry

    return store.mutate_state(mutator)


@workdir_write
def create_eval_batch(
    workdir: Path,
    *,
    name: str,
    description: str,
    config: EvalBatchConfig,
) -> EvalBatchEntry:
    """新建打分批次：规则与引用校验 → 锁内预占序号 → 锁外写配置 → 锁内登记。

    预占与登记分两段：序号在锁内定死，配置文件随后在锁外写（非状态 IO 不进
    临界区），最后才在锁内登记条目——两段之间崩溃最坏烧掉一个序号、无观察者，
    换来 state 里的条目必有配置文件在手（与打标建批同构）。

    Raises:
        EvalConfigError: 名字不合法、配置规则不过或引用不成立。
    """
    cleaned = _validate_name(name)
    config.validate()
    validate_references(workdir, config)
    store = EvalStore(workdir)
    seq = _reserve_seq(store)
    store.write_config(seq, config)
    return _append_entry(
        store,
        EvalBatchEntry(
            seq=seq,
            name=cleaned,
            description=description,
            created_at=now_iso(),
        ),
    )


@workdir_write
def update_eval_batch(
    workdir: Path,
    seq: int,
    *,
    name: str | None = None,
    description: str | None = None,
) -> EvalBatchEntry:
    """改名／改描述（纯显示元数据，配置不动）。"""
    store = EvalStore(workdir)

    def mutator(state: dict[str, object]) -> EvalBatchEntry:
        entries = entries_from_state(state)
        entry = _require_entry(entries, seq)
        if name is not None:
            entry.name = _validate_name(name)
        if description is not None:
            entry.description = description
        entries_into_state(
            state,
            [entry if item.seq == seq else item for item in entries],
        )
        return entry

    return store.mutate_state(mutator)


@workdir_write
def update_eval_config(
    workdir: Path,
    seq: int,
    config: EvalBatchConfig,
) -> EvalBatchConfig:
    """全量替换某打分批次的配置（配置可改重跑——与打标批次「组合不可改」相反）。

    校验通过后在同一把状态锁内「核批次存在 + 写配置文件」；state.json 无变化
    也照常重写（幂等、无害）。

    Raises:
        EvalConfigError: 配置规则不过或引用不成立。
        EvalBatchNotFoundError: 打分批次不存在。
    """
    config.validate()
    validate_references(workdir, config)
    store = EvalStore(workdir)

    def mutator(state: dict[str, object]) -> EvalBatchConfig:
        _require_entry(entries_from_state(state), seq)
        store.write_config(seq, config)
        return config

    return store.mutate_state(mutator)


@dataclass
class DeleteEvalBatchResult:
    """删除打分批次的清点结果（删前告知与删后汇报共用）。"""

    runs_removed: int
    reports_removed: int


def _record_batch_field(path: Path) -> str | None:
    """读一个 JSON 记录的 batch 字段；缺失、损坏一律返回 None。

    删除只信读得出的归属（与 find_strategy_references 同一容忍度——清点路径
    不因单份损坏挡住整批删除）。读不出归属的 run / report 当作「无法证明属于本
    批次」原样留在盘上：它们是现场证据，删除不越权替他域清垃圾。
    """
    try:
        data: object = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    batch = cast("dict[str, object]", data).get("batch")
    return batch if isinstance(batch, str) else None


def _owned_run_dirs(store: EvalStore, seq: int) -> list[Path]:
    """挑出属于该打分批次的运行目录（读各 run.json 的 batch 字段）。"""
    owned: list[Path] = []
    if store.runs_dir.is_dir():
        for directory in sorted(store.runs_dir.iterdir()):
            if _record_batch_field(directory / "run.json") == f"e{seq}":
                owned.append(directory)
    return owned


def _owned_reports(store: EvalStore, seq: int) -> list[Path]:
    """挑出属于该打分批次的报告快照（读各文件的 batch 字段）。"""
    owned: list[Path] = []
    if store.reports_dir.is_dir():
        for path in sorted(store.reports_dir.glob("*.json")):
            if _record_batch_field(path) == f"e{seq}":
                owned.append(path)
    return owned


def _delete_occupied_detail(occupier: dict[str, Any] | None) -> str:
    """运行中删除的拒绝文案：带占用者摘要（读不到占用者时退回笼统说明）。"""
    if not occupier:
        return _DELETE_OCCUPIED_DETAIL
    parts: list[str] = []
    for key, label in (("pid", "进程号"), ("started_at", "启动于"), ("batch", "批次")):
        value = occupier.get(key)
        if value is not None:
            parts.append(f"{label} {value}")
    body = "、".join(parts) if parts else "占用者信息不完整"
    return (
        f"该工作目录正有一个打分（评测）运行占用（{body}）——请等它结束或停止后再删除。"
    )


@workdir_write
def delete_eval_batch(workdir: Path, seq: int) -> DeleteEvalBatchResult:
    """删除打分批次：配置目录＋该批次的运行记录与报告快照，最后提交登记。

    先取 eval 运行锁（运行中不许删——与打标批次删除取运行锁同构；评测锁独立
    于打标锁，删评测批次不挡打标运行）。附属文件整体移入可恢复暂存
    （``.dsf/trash``，经 ``WorkdirStore.quarantine_paths``）、不硬删；人工打分
    不动（不绑打分批次配置）。

    暂存前先滤掉已经不存在的路径：外部手删、或上一轮暂存成功而登记提交失败后
    重试，都会遇到「要搬的东西已经不在原位」。缺文件不是错误——重试的意义就是
    从上次停下的地方接着删完。

    Raises:
        EvalBatchNotFoundError: 打分批次不存在。
        EvalRunOccupiedError: 该工作目录正有一个打分运行在跑。
    """
    get_eval_batch(workdir, seq)  # 不存在先报错，失败时现场不动
    store = EvalStore(workdir)
    lock = RunLock(store.eval_dir, occupied_detail=_DELETE_OCCUPIED_DETAIL)
    try:
        lock.acquire(
            {"pid": os.getpid(), "batch": f"e{seq}", "operation": "delete-eval-batch"}
        )
    except RunOccupiedError as exc:
        # 评测域边界把「工作目录被占用」翻成评测口径的错误类型（eval-run-occupied），
        # 不把 workdir 的通用类型漏给 API / CLI（否则映射成 run-occupied，提示张冠李戴）。
        raise EvalRunOccupiedError(
            _delete_occupied_detail(exc.occupier), occupier=exc.occupier
        ) from exc
    try:
        run_dirs = _owned_run_dirs(store, seq)
        reports = _owned_reports(store, seq)
        batch_dir = store.batch_dir(seq)

        def mutator(state: dict[str, object]) -> None:
            entries = entries_from_state(state)
            _require_entry(entries, seq)
            seq_floor = max((entry.seq for entry in entries), default=0) + 1
            entries_into_state(
                state,
                [entry for entry in entries if entry.seq != seq],
                seq_floor=seq_floor,
            )

        # 先删附属文件、后提交登记（中途失败＝「批次还在、文件少一半」，可见可续删）。
        # quarantine 内部逐项重命名并整体回滚，缺项会直接拒绝——故先滤掉已不在原位的。
        movable = [path for path in (batch_dir, *run_dirs, *reports) if path.exists()]
        if movable:
            WorkdirStore(workdir).quarantine_paths(movable)
        store.mutate_state(mutator)
        return DeleteEvalBatchResult(
            runs_removed=len(run_dirs),
            reports_removed=len(reports),
        )
    finally:
        lock.release()
