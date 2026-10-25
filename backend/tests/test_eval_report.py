"""单元测试：报告聚合与快照（五层结构 / BT 排名 / κ 与混淆矩阵 / 快照读写）。"""

from __future__ import annotations

import json
import random
from collections.abc import Iterator, Sequence
from pathlib import Path
from typing import cast

import pytest

from dataset_factory.eval import (
    DUAL_FULL,
    KIND_BINARY,
    KIND_SCORE5,
    DimensionSpec,
    EvalBatchConfig,
    EvalRunner,
    HumanSettings,
    PairwiseSettings,
    append_manual_score,
    build_report,
    create_eval_batch,
    list_reports,
    read_report,
)
from dataset_factory.llm import (
    Message,
    SecretValue,
    StreamDelta,
    TextPart,
    create_config,
)
from dataset_factory.prompts import Prompt, save_prompt
from dataset_factory.strategies import create_batch, create_strategy
from dataset_factory.workdir import WorkdirStore


class _FakeJudge:
    """固定好回复的假裁判端点（对局恒判 A、坏产物判幻觉）。"""

    def complete(self, messages: Sequence[Message]) -> str:
        """纯文本档。"""
        return self._reply(messages)

    def stream(self, messages: Sequence[Message]) -> Iterator[StreamDelta]:
        """Protocol 齐备性桩。"""
        raise NotImplementedError

    def complete_structured(
        self, messages: Sequence[Message], response_format: dict[str, object] | None
    ) -> str:
        """结构化档（同路由）。"""
        return self._reply(messages)

    def _reply(self, messages: Sequence[Message]) -> str:
        text = chr(10).join(
            part.text
            for message in messages
            for part in message.parts
            if isinstance(part, TextPart)
        )
        if "<caption-a>" in text:
            return '{"winner": "A", "理由": "A 更准确。"}'
        if "坏产物" in text:
            return '{"场景描述": 2, "无幻觉": "有", "理由": "编造。"}'
        return '{"场景描述": 4, "无幻觉": "无", "理由": "准确。"}'


@pytest.fixture
def seeded(tmp_path: Path, temp_data_root: Path) -> Path:
    """两素材两被测批次（s1__cat 为坏产物→judge 判幻觉）。"""
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
        (workdir / name).write_bytes(b"fake")
    WorkdirStore(workdir).append_import_record(
        {
            "imported_at": "2026-01-01T00:00:00Z",
            "source": "",
            "files": [
                {"name": "cat.jpg", "sha256": "0" * 64},
                {"name": "dog.jpg", "sha256": "0" * 64},
            ],
        }
    )
    for seq in (1, 2):
        create_batch(
            workdir,
            name=f"批次{seq}",
            description="",
            endpoint_id="main",
            prompt_id="详细描述",
            skill_ids=[],
        )
    (workdir / "s1__cat.txt").write_text("坏产物", encoding="utf-8")
    (workdir / "s2__cat.txt").write_text("一只猫", encoding="utf-8")
    (workdir / "s1__dog.txt").write_text("一只狗", encoding="utf-8")
    (workdir / "s2__dog.txt").write_text("一只狗在跑", encoding="utf-8")
    return workdir


def _config(judge_id: str, *, human: HumanSettings | None = None) -> EvalBatchConfig:
    """两模式全开、双序全量；人工设置按需覆写。"""
    return EvalBatchConfig(
        candidates=[1, 2],
        benchmark=None,
        judges=[judge_id],
        dimensions=[
            DimensionSpec(name="场景描述", kind=KIND_SCORE5),
            DimensionSpec(name="无幻觉", kind=KIND_BINARY),
        ],
        dimension_scoring=True,
        pairwise=True,
        pairwise_settings=PairwiseSettings(
            dual_order=DUAL_FULL, dual_order_ratio=None, limit=None
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
        dataset_source="DOCCI",
        dataset_license="CC BY 4.0",
    )


def _run_once(workdir: Path, *, human: HumanSettings | None = None) -> tuple[str, str]:
    """建裁判与打分批次、离线跑一次完成的运行，返回 (run_id, judge_id)。"""
    judge = create_strategy(
        name="裁判", endpoint_id="main", prompt_id="详细描述", skill_ids=[]
    )
    entry = create_eval_batch(
        workdir, name="第一评", description="", config=_config(judge.id, human=human)
    )
    runner = EvalRunner(
        workdir,
        entry.seq,
        completer_factory=lambda _config: _FakeJudge(),
        sleeper=lambda _seconds: None,
        rng=random.Random(1),  # noqa: S311
    )
    report = runner.run()
    assert report.status == "completed"
    return report.run_id, judge.id


def _layer(report: dict[str, object], name: str) -> dict[str, object]:
    """取报告的一层（cast 收窄）。"""
    layers = cast("dict[str, object]", report["layers"])
    return cast("dict[str, object]", layers[name])


def test_report_five_layers_and_ranking(seeded: Path) -> None:
    """五层齐备：BT 排名（双序同判 A＝小序恒胜）、维度均分、双序一致率 1。"""
    workdir = seeded
    run_id, _ = _run_once(workdir)
    report = read_report(workdir, 1, run_id)
    ranking = _layer(report, "ranking")
    rows = cast("list[dict[str, object]]", ranking["ranking"])
    assert [row["batch"] for row in rows] == ["s1", "s2"]
    ci = cast("dict[str, int]", rows[0]["ci"])
    assert ci == {"low": 1, "high": 1}
    dimensions = _layer(report, "dimensions")
    dim_rows = cast("list[dict[str, object]]", dimensions["batches"])
    assert {row["batch"] for row in dim_rows} == {"s1", "s2"}
    trust = _layer(report, "trust")
    assert trust["landis_koch_bands"]
    dual = cast("dict[str, object]", trust["dual_order_agreement"])
    assert dual["value"] == 1.0  # 双序两判都判 A，一致率 1
    badcase = _layer(report, "badcase")
    hallucination = badcase.get("judge_hallucination")
    assert isinstance(hallucination, dict)
    assert "cat" in hallucination
    repro = _layer(report, "reproducibility")
    assert repro["dataset_source"] == "DOCCI"
    assert repro["calls"] is not None
    assert cast("int", repro["calls"]) > 0
    assert cast("int", repro["pairs"]) > 0


def test_report_trust_kappa_and_confusion(seeded: Path) -> None:
    """全量人工分：κ 出值、幻觉混淆矩阵四读数全列（tp/tn 对角全对）。"""
    workdir = seeded
    # 人工分先落（人工不依赖 judge，可先打），逐 (素材×批次) 与 judge 的输出对齐
    # （s1__cat 是坏产物→judge 判幻觉+2 分；其余 4 分/无）——κ=1.0 的对角线样本。
    aligned = {
        ("cat", 1): {"场景描述": 2, "无幻觉": "有"},
        ("cat", 2): {"场景描述": 4, "无幻觉": "无"},
        ("dog", 1): {"场景描述": 4, "无幻觉": "无"},
        ("dog", 2): {"场景描述": 4, "无幻觉": "无"},
    }
    for (item, batch), scores in aligned.items():
        append_manual_score(
            workdir,
            {
                "kind": "dimension",
                "item": item,
                "batch": batch,
                "annotator": "我",
                "scores": scores,
                "reason": "复核",
            },
        )
    human = HumanSettings(
        full=True,
        random_enabled=False,
        random_count=None,
        targeted_enabled=False,
        targeted_count=None,
        dimension_manual=True,
        pairwise_manual=False,
    )
    run_id, judge_id = _run_once(workdir, human=human)
    # 全量通道没有随机题单——κ 的校准集取「随机题单」字段，把全量素材并进去
    # （运行产物是纯数据，改它即可复现「全量＝全体入校准集」的语义）。
    from dataset_factory.eval import EvalStore

    samples_path = EvalStore(workdir).runs_dir / run_id / "samples.json"
    samples = json.loads(samples_path.read_text(encoding="utf-8"))
    samples["random"] = ["cat", "dog"]
    samples_path.write_text(json.dumps(samples, ensure_ascii=False), encoding="utf-8")
    built = build_report(workdir, 1, run_id)
    trust = _layer(built, "trust")
    judges = cast("dict[str, dict[str, list[dict[str, object]]]]", trust["judges"])
    per_judge = judges[judge_id]
    kappa_row = next(
        row for row in per_judge["kappa"] if row["dimension"] == "场景描述"
    )
    assert kappa_row["kappa"] == 1.0
    assert kappa_row["n"] == 4
    confusion = next(
        row for row in per_judge["confusion"] if row["dimension"] == "无幻觉"
    )
    counts = cast("dict[str, int]", confusion["counts"])
    assert counts == {"tp": 1, "fn": 0, "fp": 0, "tn": 3}
    hit = confusion.get("抓中率")
    assert isinstance(hit, dict)
    assert hit["value"] == 1.0
    false_alarm = confusion.get("误报率")
    assert isinstance(false_alarm, dict)
    assert false_alarm["value"] == 0.0


def test_report_snapshot_list_and_mismatch(seeded: Path) -> None:
    """快照落盘可列可读；错批次的读取按不匹配拒绝。"""
    workdir = seeded
    run_id, _ = _run_once(workdir)
    summaries = list_reports(workdir, 1)
    assert [row["report_id"] for row in summaries] == [run_id]
    assert read_report(workdir, 1, run_id)["report_id"] == run_id
    judge2 = create_strategy(
        name="裁判2", endpoint_id="main", prompt_id="详细描述", skill_ids=[]
    )
    entry2 = create_eval_batch(
        workdir, name="第二评", description="", config=_config(judge2.id)
    )
    with pytest.raises(ValueError, match="不属于"):
        read_report(workdir, entry2.seq, run_id)
