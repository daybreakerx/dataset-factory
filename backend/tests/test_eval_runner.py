"""单元测试：eval 打分运行器（离线全流程 / 题单生成 / 停止 / 占用 / 基准位拒绝）。

judge 端点用按消息路由的假 completer 顶替（不真调端点）；素材与产物直接落盘、
登记走真实导入记录。
"""

from __future__ import annotations

import json
import random
import threading
from collections.abc import Callable, Iterator, Sequence
from pathlib import Path
from typing import cast

import pytest

from dataset_factory.eval import (
    DUAL_FULL,
    DUAL_SAMPLED,
    KIND_BINARY,
    KIND_SCORE5,
    DimensionSpec,
    EvalBatchConfig,
    EvalBatchNotFoundError,
    EvalConfigError,
    EvalRunner,
    EvalRunOccupiedError,
    EvalStore,
    HumanSettings,
    PairwiseSettings,
    RunReport,
    create_eval_batch,
    delete_eval_batch,
)
from dataset_factory.llm import (
    LLMRateLimitError,
    Message,
    SecretValue,
    StreamDelta,
    TextPart,
    create_config,
)
from dataset_factory.prompts import Prompt, save_prompt
from dataset_factory.runs import BatchRunner, BenchmarkBatchError
from dataset_factory.strategies import (
    create_batch,
    create_strategy,
    delete_batch,
    delete_strategy,
    set_batch_benchmark,
)
from dataset_factory.workdir import RunLock, RunOccupiedError, WorkdirStore


class RecordingCompleter:
    """按「消息全文 → 回复」路由的假裁判端点；记录每次收到的消息文本。"""

    def __init__(self, responder: Callable[[str], str]) -> None:
        """responder 抛 LLM 异常即模拟端点失败路径。"""
        self._responder = responder
        self.calls: list[str] = []

    def complete(self, messages: Sequence[Message]) -> str:
        """纯文本档。"""
        return self._reply(messages)

    def stream(self, messages: Sequence[Message]) -> Iterator[StreamDelta]:
        """judge 协议不走流式——Protocol 齐备性桩。"""
        raise NotImplementedError

    def complete_structured(
        self, messages: Sequence[Message], response_format: dict[str, object] | None
    ) -> str:
        """结构化档（内容与纯文本档同路由）。"""
        return self._reply(messages)

    def _reply(self, messages: Sequence[Message]) -> str:
        text = "\n".join(
            part.text
            for message in messages
            for part in message.parts
            if isinstance(part, TextPart)
        )
        self.calls.append(text)
        return self._responder(text)


_GOOD_DIMENSION = '{"场景描述": 4, "无幻觉": "无", "理由": "准确。"}'
_BAD_HALLUCINATION = '{"场景描述": 2, "无幻觉": "有", "理由": "编造了细节。"}'
_GOOD_PAIRWISE = '{"winner": "A", "理由": "A 更准确。"}'
_OCCUPIED_MESSAGE = "该工作目录正被另一个打分（评测）运行占用。"


def _default_responder(text: str) -> str:
    """默认路由：对局回 A 胜；维度评分按 caption 内容判幻觉。"""
    if "<caption-a>" in text:
        return _GOOD_PAIRWISE
    if "坏产物" in text:
        return _BAD_HALLUCINATION
    return _GOOD_DIMENSION


@pytest.fixture
def seeded(tmp_path: Path, temp_data_root: Path) -> Path:
    """建工作目录：两个素材（登记在册）、三个批次（s1/s2 被测、s3 基准）与产物。"""
    workdir = tmp_path / "photos"
    workdir.mkdir()
    create_config(
        "main",
        "https://api.example.com/v1",
        "test-model",
        api_key=SecretValue("test-key"),
    )
    save_prompt(Prompt(name="详细描述", description="", body="你是裁判"))
    for name in ("cat.jpg", "dog.jpg"):
        (workdir / name).write_bytes(b"fake-image-bytes")
    store = WorkdirStore(workdir)
    store.append_import_record(
        {
            "imported_at": "2026-01-01T00:00:00Z",
            "source": "",
            "files": [
                {"name": "cat.jpg", "sha256": "0" * 64},
                {"name": "dog.jpg", "sha256": "0" * 64},
            ],
        }
    )
    for seq in (1, 2, 3):
        create_batch(
            workdir,
            name=f"批次{seq}",
            description="",
            endpoint_id="main",
            prompt_id="详细描述",
            skill_ids=[],
        )
    # cat 在 s1 是坏产物（触发幻觉判定），dog 两个批次都正常。
    (workdir / "s1__cat.txt").write_text("坏产物：编造了细节", encoding="utf-8")
    (workdir / "s2__cat.txt").write_text("一只猫坐在窗台上", encoding="utf-8")
    (workdir / "s1__dog.txt").write_text("一只狗在草地上", encoding="utf-8")
    (workdir / "s2__dog.txt").write_text("一只狗在草地上跑", encoding="utf-8")
    (workdir / "s3__cat.txt").write_text("参照：一只猫在窗边", encoding="utf-8")
    (workdir / "s3__dog.txt").write_text("参照：一只狗", encoding="utf-8")
    return workdir


def _config(
    judge_id: str,
    *,
    benchmark: int | None = None,
    pairwise: bool = True,
    dual_order: str = DUAL_FULL,
    ratio: int | None = None,
    limit: int | None = None,
    human: HumanSettings | None = None,
) -> EvalBatchConfig:
    """合法配置（维度评分＋对比排名都开、双序全量）；按需覆写。"""
    return EvalBatchConfig(
        candidates=[1, 2],
        benchmark=benchmark,
        judges=[judge_id],
        dimensions=[
            DimensionSpec(name="场景描述", kind=KIND_SCORE5),
            DimensionSpec(name="无幻觉", kind=KIND_BINARY),
        ],
        dimension_scoring=True,
        pairwise=pairwise,
        pairwise_settings=None
        if not pairwise
        else PairwiseSettings(
            dual_order=dual_order, dual_order_ratio=ratio, limit=limit
        ),
        human=human
        or HumanSettings(
            full=False,
            random_enabled=False,
            random_count=None,
            targeted_enabled=False,
            targeted_count=None,
            dimension_manual=False,
            pairwise_manual=False,
        ),
        dataset_source=None,
        dataset_license=None,
    )


def _run(
    workdir: Path,
    seq: int,
    responder: Callable[[str], str] = _default_responder,
    *,
    rng: random.Random | None = None,
    on_event: Callable[[object], None] | None = None,
) -> tuple[RunReport, RecordingCompleter]:
    """跑一次打分运行（假工厂注入路由 completer），返回 (报告, completer)。"""
    completer = RecordingCompleter(responder)
    runner = EvalRunner(
        workdir,
        seq,
        completer_factory=lambda _config: completer,
        sleeper=lambda _seconds: None,
        rng=rng if rng is not None else random.Random(1),  # noqa: S311
    )
    if on_event is not None:
        runner.subscribe(on_event)
    report = runner.run()
    return report, completer


def _read_jsonl(path: Path) -> list[dict[str, object]]:
    """读一份 JSONL 流水（跳过残缺尾行）。"""
    raw = path.read_text(encoding="utf-8")
    return [json.loads(line) for line in raw.splitlines() if line.strip()]


# --------------------------------------------------------------------------
# 全流程与落盘
# --------------------------------------------------------------------------


def test_full_run_scores_dimensions_and_pairs(seeded: Path) -> None:
    """维度评分全量＋双序对局：计数闭合、三件套落盘、无人工时题单为空。"""
    workdir = seeded
    judge = create_strategy(
        name="裁判", endpoint_id="main", prompt_id="详细描述", skill_ids=[]
    )
    seq = create_eval_batch(
        workdir, name="第一评", description="", config=_config(judge.id, benchmark=3)
    ).seq
    report, completer = _run(workdir, seq)
    # 维度：2 素材 × 2 被测批次 × 1 裁判 = 4；对局：每素材 3 对（s1/s2/s3）×2 序 = 12。
    assert report.counters["planned"] == 16
    assert report.status == "completed"
    assert report.counters["succeeded"] == 16
    run_dir = report.run_dir
    scores = _read_jsonl(run_dir / "scores.jsonl")
    assert len(scores) == 4
    assert {row["item"] for row in scores} == {"cat", "dog"}
    pairs = _read_jsonl(run_dir / "pairs.jsonl")
    assert len(pairs) == 12
    both_orders = {(row["a_batch"], row["b_batch"]) for row in pairs}
    assert (1, 3) in both_orders  # 双序＝换位重发
    assert (3, 1) in both_orders
    record = json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
    assert record["status"] == "completed"
    assert record["judges"][0]["snapshot"]["prompt"]["body"] == "你是裁判"
    samples = json.loads((run_dir / "samples.json").read_text(encoding="utf-8"))
    assert samples == {"random": [], "targeted": None}
    assert "<reference>" in completer.calls[0]  # 基准参照块进 judge 输入


def test_run_record_carries_candidate_snapshots(seeded: Path) -> None:
    """run.json 带被测批次的策略快照（报告可复现层的运行侧数据源）。"""
    workdir = seeded
    judge = create_strategy(
        name="裁判", endpoint_id="main", prompt_id="详细描述", skill_ids=[]
    )
    seq = create_eval_batch(
        workdir, name="第一评", description="", config=_config(judge.id)
    ).seq
    report, _ = _run(workdir, seq)
    record = json.loads((report.run_dir / "run.json").read_text(encoding="utf-8"))
    candidates = record["candidates"]
    assert [row["batch"] for row in candidates] == ["s1", "s2"]
    for row in candidates:
        snapshot = row["snapshot"]
        assert snapshot["endpoint"]["model"] == "test-model"  # 批次配置快照
        assert snapshot["prompt"]["body"] == "你是裁判"


def test_sampled_dual_order_randomizes_left_right_of_single_order_pairs(
    seeded: Path,
) -> None:
    """双序抽验（sampled）下没抽中双序的对也随机左右，不恒为 a<b。"""
    workdir = seeded
    judge = create_strategy(
        name="裁判", endpoint_id="main", prompt_id="详细描述", skill_ids=[]
    )
    seq = create_eval_batch(
        workdir,
        name="第一评",
        description="",
        config=_config(judge.id, benchmark=3, dual_order=DUAL_SAMPLED, ratio=1),
    ).seq
    report, _ = _run(workdir, seq, rng=random.Random(3))  # noqa: S311
    rows = _read_jsonl(report.run_dir / "pairs.jsonl")
    # 每素材 3 对（s1/s2/s3）× 1 序（比例 1% 该种子未抽中双序）——左右必须两种都出现。
    assert len(rows) == 6
    orders: set[tuple[int, int]] = {
        (cast("int", row["a_batch"]), cast("int", row["b_batch"])) for row in rows
    }
    assert any(a < b for a, b in orders)
    assert any(a > b for a, b in orders)


def test_unregistered_asset_without_caption_excluded(seeded: Path) -> None:
    """未登记素材与无产物的 (素材×批次) 组合不参评（计划数只算可评对象）。"""
    workdir = seeded
    (workdir / "bird.jpg").write_bytes(b"fake")  # 未登记
    (workdir / "s1__cat.txt").unlink()  # cat 在 s1 无产物
    judge = create_strategy(
        name="裁判", endpoint_id="main", prompt_id="详细描述", skill_ids=[]
    )
    seq = create_eval_batch(
        workdir, name="第一评", description="", config=_config(judge.id)
    ).seq
    report, _ = _run(workdir, seq)
    # 维度：cat 只剩 s2（1）＋dog 2 = 3；对局：benchmark 未配置、池只有候选——
    # cat 单候选 0 对、dog 1 对 ×2 序 = 2。未登记的 bird 全程不出现。
    assert report.counters["planned"] == 5


def test_retryable_llm_error_backs_off_then_succeeds(seeded: Path) -> None:
    """可重试类失败（限流）按退避重试后成功；终态行 attempt 记实际尝试数。"""
    workdir = seeded
    judge = create_strategy(
        name="裁判", endpoint_id="main", prompt_id="详细描述", skill_ids=[]
    )
    seq = create_eval_batch(
        workdir,
        name="第一评",
        description="",
        config=_config(judge.id, pairwise=False),
    ).seq
    state = {"failed_once": False}

    def responder(text: str) -> str:
        if "<caption-a>" not in text and not state["failed_once"]:
            state["failed_once"] = True
            raise LLMRateLimitError("限流，稍后再试。")
        return _GOOD_DIMENSION if "<candidate>" in text else _GOOD_PAIRWISE

    report, _ = _run(workdir, seq, responder)
    assert report.counters["succeeded"] == 4
    scores = _read_jsonl(report.run_dir / "scores.jsonl")
    assert any(row["attempt"] == 2 for row in scores)


def test_stop_mid_run_leaves_interrupted(seeded: Path) -> None:
    """停止请求在调用边界生效：状态 interrupted、后续调用不再发、终态行不写。"""
    workdir = seeded
    judge = create_strategy(
        name="裁判", endpoint_id="main", prompt_id="详细描述", skill_ids=[]
    )
    seq = create_eval_batch(
        workdir, name="第一评", description="", config=_config(judge.id)
    ).seq

    class _StopOnFirst:
        """首条 item-updated 即请求停止。"""

        def __init__(self) -> None:
            self.runner: EvalRunner | None = None
            self.stopped = False

        def __call__(self, event: object) -> None:
            if getattr(event, "kind", "") == "item-updated" and not self.stopped:
                self.stopped = True
                assert self.runner is not None
                self.runner.stop()

    stopper = _StopOnFirst()
    completer = RecordingCompleter(_default_responder)
    runner = EvalRunner(
        workdir,
        seq,
        completer_factory=lambda _config: completer,
        sleeper=lambda _seconds: None,
        rng=random.Random(1),  # noqa: S311
    )
    stopper.runner = runner
    runner.subscribe(stopper)
    report = runner.run()
    assert report.status == "interrupted"
    assert report.counters["attempted"] < report.counters["planned"]
    samples = json.loads((report.run_dir / "samples.json").read_text(encoding="utf-8"))
    assert samples["targeted"] is None  # 中断即无判分可依


def test_run_exception_marks_run_json_failed(seeded: Path) -> None:
    """运行中抛非预期异常：run.json 落 failed 终态（不永留 running）。"""
    workdir = seeded
    judge = create_strategy(
        name="裁判", endpoint_id="main", prompt_id="详细描述", skill_ids=[]
    )
    seq = create_eval_batch(
        workdir,
        name="第一评",
        description="",
        config=_config(judge.id, pairwise=False),
    ).seq

    def responder(_text: str) -> str:
        raise RuntimeError("judge 端点崩了")

    with pytest.raises(RuntimeError, match="judge 端点崩了"):
        _run(workdir, seq, responder)
    runs = list((workdir / ".dsf" / "eval" / "runs").iterdir())
    assert len(runs) == 1
    record = json.loads((runs[0] / "run.json").read_text(encoding="utf-8"))
    assert record["status"] == "failed"
    assert record["error"] == "judge 端点崩了"
    assert record["finished_at"]
    assert record["counters"]["attempted"] == 0
    assert not list((workdir / ".dsf" / "eval" / "reports").glob("*.json"))


def test_occupied_lock_rejects_second_eval_run(
    seeded: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """锁占用的拒绝在域边界翻成 EvalRunOccupiedError（RunOccupiedError 不外泄）。"""
    workdir = seeded
    judge = create_strategy(
        name="裁判", endpoint_id="main", prompt_id="详细描述", skill_ids=[]
    )
    seq = create_eval_batch(
        workdir, name="第一评", description="", config=_config(judge.id)
    ).seq

    class _OccupiedLock:
        """抢锁即被拒的替身（真锁同进程可重入，占用语义跨进程才成立）。"""

        def __init__(self, *_args: object, **_kwargs: object) -> None:
            """与 RunLock 同构造面。"""

        def acquire(self, _occupier: dict[str, object]) -> None:
            """模拟「已有打分运行在跑」。"""
            raise RunOccupiedError(_OCCUPIED_MESSAGE, occupier={"pid": 1})

        def release(self) -> None:
            """未持有，空操作。"""

    monkeypatch.setattr("dataset_factory.eval.runner.RunLock", _OccupiedLock)
    runner = EvalRunner(
        workdir,
        seq,
        completer_factory=lambda _config: RecordingCompleter(_default_responder),
        rng=random.Random(1),  # noqa: S311
    )
    with pytest.raises(EvalRunOccupiedError, match="占用") as exc_info:
        runner.run()
    assert exc_info.value.occupier == {"pid": 1}
    assert runner.snapshot()["status"] == "failed"


def test_real_eval_lock_held_elsewhere_reports_eval_occupied(seeded: Path) -> None:
    """真实 eval 运行锁被占 → EvalRunOccupiedError 携原占用者，且不建运行目录。"""
    workdir = seeded
    judge = create_strategy(
        name="裁判", endpoint_id="main", prompt_id="详细描述", skill_ids=[]
    )
    seq = create_eval_batch(
        workdir, name="第一评", description="", config=_config(judge.id)
    ).seq
    eval_dir = EvalStore(workdir).eval_dir
    holder = RunLock(eval_dir)
    errors: list[EvalRunOccupiedError] = []

    def attempt() -> None:
        runner = EvalRunner(
            workdir,
            seq,
            completer_factory=lambda _config: RecordingCompleter(_default_responder),
            rng=random.Random(1),  # noqa: S311
        )
        # 断言在收集后统一做（线程里 assert 不透传异常）。
        try:
            runner.run()
        except EvalRunOccupiedError as exc:
            errors.append(exc)

    # 跨线程持有才是真占用（filelock 的计数按实例记账、同线程重入会成功）。
    holder.acquire({"pid": 4321, "batch": "e9", "run_id": "other-run"})
    try:
        worker = threading.Thread(target=attempt)
        worker.start()
        worker.join(15)
    finally:
        holder.release()

    assert not worker.is_alive()
    assert len(errors) == 1
    failure = errors[0]
    assert not isinstance(failure, RunOccupiedError)  # 域边界已翻译，不混用类型
    assert failure.occupier is not None
    assert failure.occupier["pid"] == 4321
    assert "评测" in str(failure)
    assert not list((workdir / ".dsf" / "eval" / "runs").glob("*/run.json"))


def test_candidate_batch_deleted_after_lock_fails_run_without_report(
    seeded: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """抢到评测锁的那一刻被测批次被删：运行失败，不留孤儿运行与 completed 报告。

    复现的是原实现的 TOCTOU：先读配置、后抢锁，删除恰好落在两步之间——配置已在
    手里照样开跑，为已删的批次建出运行记录与报告（静默缩小参评范围）。
    """
    workdir = seeded
    judge = create_strategy(
        name="裁判", endpoint_id="main", prompt_id="详细描述", skill_ids=[]
    )
    seq = create_eval_batch(
        workdir, name="第一评", description="", config=_config(judge.id)
    ).seq

    class _DeletingRunLock(RunLock):
        """抢到评测锁后立刻删掉被测批次（模拟锁外预检与锁内开跑之间的删除）。"""

        def acquire(self, occupier: dict[str, object]) -> None:
            """先真抢锁，再制造「批次已被删」的现场。"""
            super().acquire(occupier)
            delete_batch(workdir, 1)

    monkeypatch.setattr("dataset_factory.eval.runner.RunLock", _DeletingRunLock)
    with pytest.raises(EvalConfigError, match="被测批次不存在"):
        _run(workdir, seq)
    eval_dir = workdir / ".dsf" / "eval"
    assert not list((eval_dir / "runs").glob("*/run.json"))  # 没有孤儿运行记录
    assert not list((eval_dir / "reports").glob("*.json"))  # 更没有 completed 报告


def test_eval_batch_deleted_before_run_reports_batch_not_found(seeded: Path) -> None:
    """打分批次本身被删：锁内复核报 EvalBatchNotFoundError（不静默跳过）。"""
    workdir = seeded
    judge = create_strategy(
        name="裁判", endpoint_id="main", prompt_id="详细描述", skill_ids=[]
    )
    seq = create_eval_batch(
        workdir, name="第一评", description="", config=_config(judge.id)
    ).seq
    delete_eval_batch(workdir, seq)
    with pytest.raises(EvalBatchNotFoundError, match="不在工作目录中"):
        _run(workdir, seq)
    assert not list((workdir / ".dsf" / "eval" / "runs").glob("*/run.json"))


def test_run_fails_clearly_when_judge_strategy_deleted(seeded: Path) -> None:
    """裁判策略被删 → 引用不成立，运行直接失败并报清楚（不静默跳过）。"""
    workdir = seeded
    judge = create_strategy(
        name="裁判", endpoint_id="main", prompt_id="详细描述", skill_ids=[]
    )
    seq = create_eval_batch(
        workdir, name="第一评", description="", config=_config(judge.id)
    ).seq
    delete_strategy(judge.id)
    with pytest.raises(EvalConfigError, match="不在策略库中"):
        _run(workdir, seq)


def test_samples_random_before_judge_and_targeted_after(seeded: Path) -> None:
    """随机题单在 judge 前出（不依赖判分）、定向题单在 judge 后按判分挑选。"""
    workdir = seeded
    judge = create_strategy(
        name="裁判", endpoint_id="main", prompt_id="详细描述", skill_ids=[]
    )
    human = HumanSettings(
        full=False,
        random_enabled=True,
        random_count=1,
        targeted_enabled=True,
        targeted_count=1,
        dimension_manual=True,
        pairwise_manual=False,
    )
    seq = create_eval_batch(
        workdir,
        name="第一评",
        description="",
        config=_config(judge.id, pairwise=False, human=human),
    ).seq
    report, _ = _run(workdir, seq, rng=random.Random(7))  # noqa: S311
    samples = json.loads((report.run_dir / "samples.json").read_text(encoding="utf-8"))
    assert len(samples["random"]) == 1  # 两个素材抽一
    targeted = samples["targeted"]
    assert targeted is not None
    assert targeted["items"] == ["cat"]  # s1__cat 判「有幻觉」→ 优先全收
    assert "cat" in targeted["basis"]["hallucination"]


def test_targeted_only_pairwise_manual_skips_dimension_badcases(seeded: Path) -> None:
    """只勾对比人工：定向名单只收胜负分歧，不收维度坏例（幻觉 / 低分）。"""
    workdir = seeded
    judge = create_strategy(
        name="裁判", endpoint_id="main", prompt_id="详细描述", skill_ids=[]
    )
    human = HumanSettings(
        full=False,
        random_enabled=False,
        random_count=None,
        targeted_enabled=True,
        targeted_count=2,
        dimension_manual=False,
        pairwise_manual=True,
    )

    def responder(text: str) -> str:
        """对局按「含窗台的 caption 在哪一位」判胜——换位后 winner 跟着翻即分歧。"""
        if "<caption-a>" not in text:
            return _GOOD_DIMENSION
        caption_a = text.split("<caption-a>")[1].split("</caption-a>")[0]
        caption_b = text.split("<caption-b>")[1].split("</caption-b>")[0]
        if "窗台" in caption_a:
            winner = "A"
        elif "窗台" in caption_b:
            winner = "B"
        else:
            winner = "tie"
        return json.dumps({"winner": winner, "理由": "按参照判。"}, ensure_ascii=False)

    seq = create_eval_batch(
        workdir,
        name="第一评",
        description="",
        config=_config(judge.id, human=human),
    ).seq
    report, _ = _run(workdir, seq, responder)
    targeted = json.loads(
        (report.run_dir / "samples.json").read_text(encoding="utf-8")
    )["targeted"]
    assert targeted["items"] == ["cat"]  # 只有 cat 的两序胜负不一致
    assert targeted["basis"]["divergent"] == ["cat"]
    # 维度人工没开：维度坏例（s1__cat 判「有幻觉」）不该进名单与依据。
    assert targeted["basis"]["hallucination"] == []
    assert targeted["basis"]["low_score"] == []


def test_targeted_only_dimension_manual_skips_pairwise_divergence(
    seeded: Path,
) -> None:
    """只勾维度人工：定向名单只收幻觉 / 低分，不收对局胜负分歧。"""
    workdir = seeded
    judge = create_strategy(
        name="裁判", endpoint_id="main", prompt_id="详细描述", skill_ids=[]
    )
    human = HumanSettings(
        full=False,
        random_enabled=False,
        random_count=None,
        targeted_enabled=True,
        targeted_count=1,
        dimension_manual=True,
        pairwise_manual=False,
    )

    def responder(text: str) -> str:
        """对局总要给出「换位即翻」的胜负（制造分歧），维度评分照默认判。"""
        if "<caption-a>" not in text:
            return _default_responder(text)
        caption_a = text.split("<caption-a>")[1].split("</caption-a>")[0]
        return json.dumps(
            {"winner": "A" if "一只猫" in caption_a else "B", "理由": "随便判。"},
            ensure_ascii=False,
        )

    seq = create_eval_batch(
        workdir,
        name="第一评",
        description="",
        config=_config(judge.id, human=human),
    ).seq
    report, _ = _run(workdir, seq, responder)
    targeted = json.loads(
        (report.run_dir / "samples.json").read_text(encoding="utf-8")
    )["targeted"]
    assert targeted["items"] == ["cat"]  # 幻觉条目优先全收
    assert targeted["basis"]["divergent"] == []  # 对比人工没开，分歧不入依据


def test_labeling_run_rejects_benchmark_batch(seeded: Path) -> None:
    """基准批次禁跑打标批（发车判定拒绝；一跑会覆盖摆放的参照）。"""
    workdir = seeded
    set_batch_benchmark(workdir, 1, True)
    runner = BatchRunner(
        workdir,
        1,
        RecordingCompleter(_default_responder),
        mode="full",
        trigger="web",
    )
    with pytest.raises(BenchmarkBatchError, match="基准批次"):
        runner.run()
