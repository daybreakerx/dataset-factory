"""单元测试：报告聚合与快照（五层结构 / BT 排名 / κ 与混淆矩阵 / 快照读写）。"""

from __future__ import annotations

import json
import math
import random
from collections.abc import Iterator, Mapping, Sequence
from itertools import pairwise
from pathlib import Path
from typing import cast

import pytest

from dataset_factory.eval import (
    DUAL_FULL,
    KIND_BINARY,
    KIND_SCORE5,
    DimensionSpec,
    EvalBatchConfig,
    EvalReportCorruptedError,
    EvalRunner,
    EvalStore,
    HumanSettings,
    PairwiseSettings,
    append_manual_score,
    build_report,
    create_eval_batch,
    list_reports,
    read_report,
)
from dataset_factory.eval import report as report_module
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


#: 人工全量、维度人工开、对比人工关——全量通道下校准集＝参评条目全集。
_FULL_DIMENSION_HUMAN = HumanSettings(
    full=True,
    random_enabled=False,
    random_count=None,
    targeted_enabled=False,
    targeted_count=None,
    dimension_manual=True,
    pairwise_manual=False,
)

_ALIGNED_MANUAL: dict[tuple[str, int], dict[str, object]] = {
    ("cat", 1): {"场景描述": 2, "无幻觉": "有"},
    ("cat", 2): {"场景描述": 4, "无幻觉": "无"},
    ("dog", 1): {"场景描述": 4, "无幻觉": "无"},
    ("dog", 2): {"场景描述": 4, "无幻觉": "无"},
}


def _append_manual(
    workdir: Path,
    *,
    kind: str,
    item: str,
    annotator: str,
    scores: Mapping[str, object] | None = None,
    batch: int | None = None,
    a_batch: int | None = None,
    b_batch: int | None = None,
    winner: str | None = None,
) -> None:
    """追加一条人工打分（维度或对比；低分统一带理由，过校验）。"""
    record: dict[str, object] = {"kind": kind, "item": item, "annotator": annotator}
    if kind == "dimension":
        assert batch is not None
        assert scores is not None
        record["batch"] = batch
        record["scores"] = dict(scores)
    else:
        assert a_batch is not None
        assert b_batch is not None
        assert winner is not None
        record["a_batch"] = a_batch
        record["b_batch"] = b_batch
        record["winner"] = winner
    record["reason"] = "复核"
    append_manual_score(workdir, record)


def _full_manual_report(workdir: Path) -> tuple[str, str]:
    """人工全量（与 judge 判定对齐的人工分）跑一次，返回 (run_id, judge_id)。"""
    for (item, batch), scores in _ALIGNED_MANUAL.items():
        _append_manual(
            workdir,
            kind="dimension",
            item=item,
            batch=batch,
            annotator="我",
            scores=scores,
        )
    return _run_once(workdir, human=_FULL_DIMENSION_HUMAN)


def test_report_five_layers_and_ranking(seeded: Path) -> None:
    """五层齐备：双序假裁判恒判 A＝纯位置偏好→归组判平局、名次并列；双序一致率 0。"""
    workdir = seeded
    run_id, _ = _run_once(workdir)
    report = read_report(workdir, 1, run_id)
    ranking = _layer(report, "ranking")
    rows = cast("list[dict[str, object]]", ranking["ranking"])
    assert [row["batch"] for row in rows] == ["s1", "s2"]
    # 两序都判 A 是位置标签：解析成批次后两判指向不同批次 → 该对判平局。
    assert [row["rank"] for row in rows] == [1.5, 1.5]
    ci = cast("dict[str, float]", rows[0]["ci"])
    assert ci == {"low": 1.5, "high": 1.5}
    assert ranking["comparable"] is True
    dimensions = _layer(report, "dimensions")
    dim_rows = cast("list[dict[str, object]]", dimensions["batches"])
    assert {row["batch"] for row in dim_rows} == {"s1", "s2"}
    trust = _layer(report, "trust")
    assert trust["landis_koch_bands"]
    dual = cast("dict[str, object]", trust["dual_order_agreement"])
    assert dual["value"] == 0.0  # 纯位置偏好：两序指向不同批次，一致率 0
    badcase = _layer(report, "badcase")
    hallucination = badcase.get("judge_hallucination")
    assert isinstance(hallucination, dict)
    assert "cat" in hallucination
    repro = _layer(report, "reproducibility")
    assert repro["dataset_source"] == "DOCCI"
    assert repro["calls"] is not None
    assert cast("int", repro["calls"]) > 0
    assert cast("int", repro["pairs"]) > 0


def test_report_full_manual_calibration_without_random_sample(seeded: Path) -> None:
    """人工全量：校准集取参评条目全集（不靠改 samples.json），κ 与混淆矩阵照出。"""
    workdir = seeded
    run_id, judge_id = _full_manual_report(workdir)
    samples = json.loads(
        (EvalStore(workdir).runs_dir / run_id / "samples.json").read_text(
            encoding="utf-8"
        )
    )
    assert samples["random"] == []  # 全量通道本来就没有随机题单
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


def test_report_uses_manual_scores_at_generation_time(seeded: Path) -> None:
    """人工分可在 judge 跑完后补打：生成报告时读当前快照，三层消费同一份。"""
    workdir = seeded
    run_id, judge_id = _run_once(workdir, human=_FULL_DIMENSION_HUMAN)
    for (item, batch), scores in _ALIGNED_MANUAL.items():
        _append_manual(
            workdir,
            kind="dimension",
            item=item,
            batch=batch,
            annotator="我",
            scores=scores,
        )
    built = build_report(workdir, 1, run_id)
    trust = _layer(built, "trust")
    judges = cast("dict[str, dict[str, list[dict[str, object]]]]", trust["judges"])
    kappa_row = next(
        row for row in judges[judge_id]["kappa"] if row["dimension"] == "场景描述"
    )
    assert kappa_row["n"] == len(_ALIGNED_MANUAL)
    repro = _layer(built, "reproducibility")
    manual = cast("list[dict[str, object]]", repro["manual_scores"])
    assert len(manual) == len(_ALIGNED_MANUAL)
    assert all(record["annotator"] == "我" for record in manual)


def test_kappa_readout_has_ci_and_n(seeded: Path) -> None:
    """每个 κ 读数随附按条目聚簇的 Bootstrap 区间与样本量（全量／随机同一口径）。"""
    workdir = seeded
    run_id, judge_id = _full_manual_report(workdir)
    built = build_report(workdir, 1, run_id)
    trust = _layer(built, "trust")
    judges = cast("dict[str, dict[str, list[dict[str, object]]]]", trust["judges"])
    kappa_row = next(
        row for row in judges[judge_id]["kappa"] if row["dimension"] == "场景描述"
    )
    assert kappa_row["n"] == 4
    ci = cast("dict[str, float]", kappa_row["ci"])
    assert ci == {"low": 1.0, "high": 1.0}


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


# --------------------------------------------------------------------------
# 统计层的数值稳定与口径
# --------------------------------------------------------------------------


def test_bt_fit_finite_for_separated_and_single_game_graphs() -> None:
    """全胜／单场／链式／断开分量／全平局都返回有限正强度（不出 nan／除零）。"""
    cases: dict[str, tuple[dict[tuple[int, int], list[float]], list[int]]] = {
        "两选手全胜": ({(1, 2): [1.0, 1.0, 1.0]}, [1, 2]),
        "只打一场": ({(1, 2): [1.0]}, [1, 2]),
        "链式 1>2>3": ({(1, 2): [1.0], (2, 3): [1.0]}, [1, 2, 3]),
        "断开分量": ({(1, 2): [1.0], (3, 4): [1.0]}, [1, 2, 3, 4]),
        "全平局": ({(1, 2): [0.5, 0.5, 0.5]}, [1, 2]),
    }
    for name, (matchups, players) in cases.items():
        strength = report_module._fit_bradley_terry(  # pyright: ignore[reportPrivateUsage]
            matchups, players
        )
        assert set(strength) == set(players), name
        assert all(math.isfinite(value) and value > 0 for value in strength.values()), (
            name
        )
        json.dumps(strength, allow_nan=False)  # 不允许 nan/inf 混进报告 JSON
    single = report_module._fit_bradley_terry(  # pyright: ignore[reportPrivateUsage]
        {(1, 2): [1.0]}, [1, 2]
    )
    assert single[1] > single[2]
    chain = report_module._fit_bradley_terry(  # pyright: ignore[reportPrivateUsage]
        {(1, 2): [1.0], (2, 3): [1.0]}, [1, 2, 3]
    )
    assert chain[1] > chain[2] > chain[3]
    tied = report_module._fit_bradley_terry(  # pyright: ignore[reportPrivateUsage]
        {(1, 2): [0.5, 0.5]}, [1, 2]
    )
    assert math.isclose(tied[1], tied[2], rel_tol=1e-9)


def test_ranking_ties_average_and_disconnected_components() -> None:
    """全平局取平均名次；断开分量标 comparable: false 并列出分量。"""
    config = _config("judge-id")
    tie_rows: list[dict[str, object]] = [
        {
            "status": "succeeded",
            "item": "cat",
            "a_batch": 1,
            "b_batch": 2,
            "judge": "judge-id",
            "winner": "tie",
        }
    ]
    tied = report_module._ranking_layer(  # pyright: ignore[reportPrivateUsage]
        tie_rows, config
    )
    assert tied is not None
    assert tied["comparable"] is True
    assert tied["components"] == [["s1", "s2"]]
    tied_rows = cast("list[dict[str, object]]", tied["ranking"])
    assert [row["rank"] for row in tied_rows] == [1.5, 1.5]
    assert [row["strength"] for row in tied_rows] == [1.0, 1.0]

    disjoint_rows: list[dict[str, object]] = [
        tie_rows[0] | {"item": "cat", "winner": "A"},
        tie_rows[0] | {"item": "dog", "a_batch": 3, "b_batch": 4, "winner": "A"},
    ]
    disjoint = report_module._ranking_layer(  # pyright: ignore[reportPrivateUsage]
        disjoint_rows, config
    )
    assert disjoint is not None
    assert disjoint["comparable"] is False
    assert disjoint["components"] == [["s1", "s2"], ["s3", "s4"]]
    disjoint_rows_out = cast("list[dict[str, object]]", disjoint["ranking"])
    ranks = {row["batch"]: row["rank"] for row in disjoint_rows_out}
    assert ranks == {"s1": 1.5, "s3": 1.5, "s2": 3.5, "s4": 3.5}
    assert all(
        math.isfinite(cast("float", row["strength"])) for row in disjoint_rows_out
    )

    chain_rows: list[dict[str, object]] = [
        tie_rows[0] | {"item": "cat", "winner": "A"},
        tie_rows[0] | {"item": "dog", "a_batch": 2, "b_batch": 3, "winner": "A"},
    ]
    chain = report_module._ranking_layer(  # pyright: ignore[reportPrivateUsage]
        chain_rows, config
    )
    assert chain is not None
    assert chain["comparable"] is True
    assert chain["components"] == [["s1", "s2", "s3"]]


def test_rank_bootstrap_resamples_items_as_clusters() -> None:
    """名次 Bootstrap 按条目整簇重抽：同一条目的多局一起进出、重数保留。"""
    resolved: dict[tuple[object, ...], dict[int, float]] = {
        ("cat", frozenset((1, 2)), "j"): {1: 1.0, 2: 0.0},
        ("cat", frozenset((1, 3)), "j"): {1: 1.0, 3: 0.0},
        ("dog", frozenset((1, 2)), "j"): {1: 0.0, 2: 1.0},
    }
    clusters = report_module._item_clusters(  # pyright: ignore[reportPrivateUsage]
        resolved
    )
    assert {item: len(shares) for item, shares in clusters.items()} == {
        "cat": 2,
        "dog": 1,
    }
    cat_ids = {id(share) for share in clusters["cat"]}
    rng = random.Random(11)  # noqa: S311 — 测试里的抽样复现
    observed: set[int] = set()
    for _ in range(200):
        drawn = report_module._draw_item_records(  # pyright: ignore[reportPrivateUsage]
            clusters, rng
        )
        cat_count = sum(1 for share in drawn if id(share) in cat_ids)
        # cat 的两局只能 0／2／4 次出现（整簇进出、有放回保留重数）。
        assert cat_count % 2 == 0
        observed.add(cat_count)
    assert observed == {0, 2, 4}


def test_dual_order_agreement_compares_batches_not_positions() -> None:
    """双序一致率按「两判指向同一批次」算：位置偏好算不一致、模型一致算一致。"""
    position_rows: list[dict[str, object]] = [
        {
            "status": "succeeded",
            "item": "cat",
            "a_batch": 1,
            "b_batch": 2,
            "judge": "j",
            "winner": "A",
        },
        {
            "status": "succeeded",
            "item": "cat",
            "a_batch": 2,
            "b_batch": 1,
            "judge": "j",
            "winner": "A",
        },
    ]
    assert report_module._dual_order_agreement_flags(  # pyright: ignore[reportPrivateUsage]
        position_rows
    ) == {"cat": [False]}
    consistent_rows: list[dict[str, object]] = [
        position_rows[0],
        position_rows[1] | {"winner": "B"},  # 换位后判 B，仍指向批次 1
    ]
    assert report_module._dual_order_agreement_flags(  # pyright: ignore[reportPrivateUsage]
        consistent_rows
    ) == {"cat": [True]}
    tie_rows: list[dict[str, object]] = [
        position_rows[0] | {"winner": "tie"},
        position_rows[1] | {"winner": "tie"},
    ]
    assert report_module._dual_order_agreement_flags(  # pyright: ignore[reportPrivateUsage]
        tie_rows
    ) == {"cat": [True]}


def test_manual_index_takes_latest_recorded_at_across_annotators() -> None:
    """人工索引跨标注者按 recorded_at 取最新（不看追加顺序）。"""
    records: list[dict[str, object]] = [
        {
            "kind": "dimension",
            "item": "cat",
            "batch": 1,
            "annotator": "乙",
            "scores": {"场景描述": 2},
            "recorded_at": "2026-01-01T00:00:01+00:00",
        },
        {
            "kind": "dimension",
            "item": "cat",
            "batch": 1,
            "annotator": "甲",
            "scores": {"场景描述": 4},
            "recorded_at": "2026-01-01T00:00:02+00:00",
        },
        {
            "kind": "pair",
            "item": "cat",
            "a_batch": 1,
            "b_batch": 2,
            "annotator": "乙",
            "winner": "B",
            "recorded_at": "2026-01-01T00:00:03+00:00",
        },
        {
            "kind": "pair",
            "item": "cat",
            "a_batch": 1,
            "b_batch": 2,
            "annotator": "甲",
            "winner": "A",
            "recorded_at": "2026-01-01T00:00:04+00:00",
        },
    ]
    dimension_index = report_module._manual_dimension_index(  # pyright: ignore[reportPrivateUsage]
        records
    )
    assert dimension_index[("cat", 1)]["annotator"] == "甲"
    pair_index = report_module._manual_pair_index(  # pyright: ignore[reportPrivateUsage]
        records
    )
    assert pair_index[("cat", frozenset((1, 2)))] == "1"


def test_annotator_agreement_with_two_annotators(seeded: Path) -> None:
    """两名标注者：维度分／对比判定按重叠题对出 exact agreement（含 n 与 CI）。"""
    workdir = seeded
    for (item, batch), scores in _ALIGNED_MANUAL.items():
        _append_manual(
            workdir,
            kind="dimension",
            item=item,
            batch=batch,
            annotator="我",
            scores=scores,
        )
    for (item, batch), scores in _ALIGNED_MANUAL.items():
        mismatched = (
            {"场景描述": 4, "无幻觉": "无"} if (item, batch) == ("cat", 1) else scores
        )
        _append_manual(
            workdir,
            kind="dimension",
            item=item,
            batch=batch,
            annotator="同事",
            scores=mismatched,
        )
    _append_manual(
        workdir,
        kind="pair",
        item="cat",
        a_batch=1,
        b_batch=2,
        annotator="我",
        winner="A",
    )
    _append_manual(
        workdir,
        kind="pair",
        item="cat",
        a_batch=1,
        b_batch=2,
        annotator="同事",
        winner="B",
    )
    human = HumanSettings(
        full=True,
        random_enabled=False,
        random_count=None,
        targeted_enabled=False,
        targeted_count=None,
        dimension_manual=True,
        pairwise_manual=True,
    )
    run_id, _ = _run_once(workdir, human=human)
    trust = _layer(build_report(workdir, 1, run_id), "trust")
    agreement = cast("dict[str, object]", trust["annotator_agreement"])
    assert agreement["annotators"] == ["同事", "我"]
    dimension = cast("dict[str, object]", agreement["dimension"])
    assert dimension["value"] == 0.75  # 4 个重叠题对里 3 个完全一致
    assert dimension["n"] == 4
    assert dimension["ci"] is not None
    pairwise = cast("dict[str, object]", agreement["pairwise"])
    assert pairwise["value"] == 0.0  # 同一对指向不同批次
    assert pairwise["n"] == 1


def test_manual_low_scores_keyed_by_item_and_batch(seeded: Path) -> None:
    """人工低分按 (素材, 批次) 复合键落表；定向查准率不把 s2 的低分算到 s1 头上。"""
    workdir = seeded
    _append_manual(
        workdir,
        kind="dimension",
        item="cat",
        batch=1,
        annotator="我",
        scores={"场景描述": 4},
    )
    _append_manual(
        workdir,
        kind="dimension",
        item="cat",
        batch=2,
        annotator="我",
        scores={"场景描述": 2},
    )
    _append_manual(
        workdir,
        kind="dimension",
        item="dog",
        batch=1,
        annotator="我",
        scores={"场景描述": 2},
    )
    _append_manual(
        workdir,
        kind="dimension",
        item="dog",
        batch=2,
        annotator="我",
        scores={"场景描述": 2},
    )
    samples: dict[str, object] = {"targeted": {"items": ["cat", "dog"]}}
    manual = report_module._read_latest_manual(workdir)  # pyright: ignore[reportPrivateUsage]
    layer = report_module._badcase_layer(  # pyright: ignore[reportPrivateUsage]
        [], samples, manual
    )
    assert layer is not None
    lows = cast("dict[str, object]", layer["manual_low_scores"])
    assert "cat·s2" in lows
    assert "cat·s1" not in lows
    assert "cat" not in lows  # 不再按素材主干裸键聚合
    targeted = cast("dict[str, object]", layer["targeted"])
    precision = cast("dict[str, object]", targeted["precision"])
    # cat 只有 s2 低（s1 高分）→ 不算命中；dog 两个已打分批次都低 → 命中。
    assert precision["value"] == 0.5
    assert precision["n"] == 2
    assert precision["hits"] == 1


def test_reproducibility_reports_actual_calls_and_snapshot_inputs(seeded: Path) -> None:
    """可复现层：calls 取实际调用数、planned_calls 单列；候选与人工快照有就用。"""
    workdir = seeded
    run_id, _ = _run_once(workdir)
    built = build_report(workdir, 1, run_id)
    record = json.loads(
        (EvalStore(workdir).runs_dir / run_id / "run.json").read_text(encoding="utf-8")
    )
    counters = cast("dict[str, int]", record["counters"])
    repro = _layer(built, "reproducibility")
    assert repro["calls"] == counters["attempted"]
    assert repro["planned_calls"] == counters["planned"]
    assert cast("int", repro["calls"]) > 0
    assert repro["manual_scores"] == []  # 没有人工分时回退读工作目录（空）

    candidates: list[object] = [{"batch": "s1", "snapshot": {"sha256": "x"}}]
    manual_snapshot: list[dict[str, object]] = [{"kind": "dimension", "item": "cat"}]
    synthetic: dict[str, object] = {
        "pairs": {"pairs": 3, "dual_pairs": 2},
        "counters": {"attempted": 5, "planned": 6},
        "candidates": candidates,
    }
    layer = report_module._reproducibility_layer(  # pyright: ignore[reportPrivateUsage]
        _config("judge-id"), synthetic, manual_snapshot
    )
    assert layer["calls"] == 5
    assert layer["planned_calls"] == 6
    assert layer["candidates"] == candidates
    assert layer["manual_scores"] == manual_snapshot


def test_landis_koch_bands_do_not_overlap() -> None:
    """分级带相邻端点不共享：0.40 只落 fair、0.41 只落 moderate。"""
    bands = report_module.LANDIS_KOCH_BANDS
    for previous, following in pairwise(bands):
        assert cast("float", previous["high"]) < cast("float", following["low"])

    def label(value: float) -> str:
        """按 [low, high] 找唯一所属带。"""
        matches = [
            band
            for band in bands
            if cast("float", band["low"]) <= value <= cast("float", band["high"])
        ]
        assert len(matches) == 1, value
        return cast("str", matches[0]["label"])

    assert label(-0.10) == "poor"
    assert label(0.0) == "slight"
    assert label(0.20) == "slight"
    assert label(0.40) == "fair"
    assert label(0.41) == "moderate"
    assert label(0.60) == "moderate"
    assert label(0.61) == "substantial"
    assert label(0.80) == "substantial"
    assert label(0.81) == "almost perfect"
    assert label(1.0) == "almost perfect"


def test_metric_rng_is_stable_per_name() -> None:
    """Bootstrap 种子按指标名派生：同名稳定、异名独立（增删读数不挪别的区间）。"""
    first = report_module._metric_rng(  # pyright: ignore[reportPrivateUsage]
        "kappa.j.场景描述"
    ).random()
    assert (
        report_module._metric_rng(  # pyright: ignore[reportPrivateUsage]
            "kappa.j.场景描述"
        ).random()
        == first
    )
    assert (
        report_module._metric_rng(  # pyright: ignore[reportPrivateUsage]
            "dual_order_agreement"
        ).random()
        != first
    )


# --------------------------------------------------------------------------
# 报告标识越界与损坏产物
# --------------------------------------------------------------------------


def test_report_identifier_path_traversal_rejected(seeded: Path) -> None:
    """run_id／report_id 含路径穿越一律按非法标识拒绝，不读目录外文件。"""
    workdir = seeded
    run_id, _ = _run_once(workdir)
    outside = workdir / ".dsf" / "evil.json"
    outside.write_text('{"batch": "e1"}', encoding="utf-8")
    with pytest.raises(ValueError, match="不合法"):
        read_report(workdir, 1, "../../evil")
    with pytest.raises(ValueError, match="不合法"):
        build_report(workdir, 1, "../../evil")
    assert read_report(workdir, 1, run_id)["report_id"] == run_id


def test_corrupted_report_snapshot_raises_domain_error(seeded: Path) -> None:
    """报告快照不是对象／不是 JSON → EvalReportCorruptedError（HTTP 层映射 409）。"""
    workdir = seeded
    run_id, _ = _run_once(workdir)
    path = EvalStore(workdir).reports_dir / f"{run_id}.json"
    path.write_text("[1, 2]", encoding="utf-8")
    with pytest.raises(EvalReportCorruptedError):
        read_report(workdir, 1, run_id)
    path.write_text("{不是 JSON", encoding="utf-8")
    with pytest.raises(EvalReportCorruptedError):
        read_report(workdir, 1, run_id)


def test_jsonl_truncated_tail_tolerated_and_middle_row_rejected(
    tmp_path: Path,
) -> None:
    """流水残缺尾行容忍；中间坏行抛 EvalReportCorruptedError。"""
    path = tmp_path / "scores.jsonl"
    path.write_text('{"a": 1}\n{"b": ', encoding="utf-8")
    assert report_module._read_jsonl(  # pyright: ignore[reportPrivateUsage]
        path
    ) == [{"a": 1}]
    path.write_text('{"a": 1}\n{"b": \n{"c": 2}\n', encoding="utf-8")
    with pytest.raises(EvalReportCorruptedError):
        report_module._read_jsonl(path)  # pyright: ignore[reportPrivateUsage]
    path.write_text('{"a": 1}\n[1, 2]\n', encoding="utf-8")
    with pytest.raises(EvalReportCorruptedError):
        report_module._read_jsonl(path)  # pyright: ignore[reportPrivateUsage]


def test_corrupted_run_artifacts_raise_domain_error(seeded: Path) -> None:
    """run.json 损坏／非对象抛域异常；运行目录缺失仍是 FileNotFoundError（404）。"""
    workdir = seeded
    run_id, _ = _run_once(workdir)
    run_dir = EvalStore(workdir).runs_dir / run_id
    record_path = run_dir / "run.json"
    original = record_path.read_text(encoding="utf-8")
    record_path.write_text("[1, 2]", encoding="utf-8")
    with pytest.raises(EvalReportCorruptedError):
        build_report(workdir, 1, run_id)
    record_path.write_text("{不是 JSON", encoding="utf-8")
    with pytest.raises(EvalReportCorruptedError):
        build_report(workdir, 1, run_id)
    corrupted_record = json.loads(original)
    corrupted_record["config"] = {"candidates": "不是数组"}
    record_path.write_text(
        json.dumps(corrupted_record, ensure_ascii=False), encoding="utf-8"
    )
    with pytest.raises(EvalReportCorruptedError):
        build_report(workdir, 1, run_id)
    record_path.write_text(original, encoding="utf-8")
    with pytest.raises(FileNotFoundError):
        build_report(workdir, 1, "20990101T000000Z")


def test_report_corrupted_error_maps_to_409_problem() -> None:
    """EvalReportCorruptedError 在 problem+json 规则表里映射 409 eval-report-corrupted。"""
    from dataset_factory.api.app import (
        _PROBLEM_RULES,  # pyright: ignore[reportPrivateUsage]
    )

    rule = next(
        rule
        for rule in _PROBLEM_RULES  # pyright: ignore[reportPrivateUsage]
        if rule.exc is EvalReportCorruptedError
    )
    assert rule.status == 409
    assert rule.slug == "eval-report-corrupted"
