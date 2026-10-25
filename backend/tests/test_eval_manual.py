"""单元测试：人工打分存取（追加／每键最近一条／低分必填理由／进度汇总）。"""

from __future__ import annotations

from pathlib import Path

import pytest

from dataset_factory.eval import (
    EvalConfigError,
    append_manual_score,
    latest_manual_scores,
    manual_progress,
    read_manual_scores,
)


def _dimension(
    item: str = "cat", score: int = 4, reason: str | None = "不错"
) -> dict[str, object]:
    """一条合法的维度打分记录。"""
    record: dict[str, object] = {
        "kind": "dimension",
        "item": item,
        "batch": 1,
        "annotator": "我",
        "scores": {"场景描述": score, "无幻觉": "无"},
    }
    if reason is not None:
        record["reason"] = reason
    return record


def test_append_and_read_roundtrip(tmp_path: Path) -> None:
    """追加两条（维度＋对比）后原样读回，recorded_at 补齐。"""
    workdir = tmp_path
    stored = append_manual_score(workdir, _dimension())
    assert stored["recorded_at"]
    append_manual_score(
        workdir,
        {
            "kind": "pair",
            "item": "cat",
            "a_batch": 1,
            "b_batch": 2,
            "annotator": "我",
            "winner": "A",
            "reason": "A 更准",
        },
    )
    records = read_manual_scores(workdir)
    assert len(records) == 2
    assert records[1]["winner"] == "A"


def test_latest_wins_on_resubmit(tmp_path: Path) -> None:
    """改分＝再追加一条；每键取最近一条，旧记录只在文件里留痕。"""
    workdir = tmp_path
    append_manual_score(workdir, _dimension(score=2, reason="差"))
    append_manual_score(workdir, _dimension(score=5))
    assert len(read_manual_scores(workdir)) == 2  # 留痕不删
    latest = latest_manual_scores(workdir)
    assert len(latest) == 1
    scores = latest[0]["scores"]
    assert isinstance(scores, dict)
    assert scores["场景描述"] == 5


def test_low_score_requires_reason(tmp_path: Path) -> None:
    """五档 ≤2 视为低分，理由必填；给理由即过。"""
    with pytest.raises(EvalConfigError, match="理由必填"):
        append_manual_score(tmp_path, _dimension(score=2, reason=None))
    append_manual_score(tmp_path, _dimension(score=2, reason="编造了细节"))


def test_pair_validation_rules(tmp_path: Path) -> None:
    """对比判定：同批自比拒绝、winner 出界拒绝。"""
    with pytest.raises(EvalConfigError, match="同一个批次"):
        append_manual_score(
            tmp_path,
            {
                "kind": "pair",
                "item": "cat",
                "a_batch": 1,
                "b_batch": 1,
                "annotator": "我",
                "winner": "A",
            },
        )
    with pytest.raises(EvalConfigError, match="A、B 或 tie"):
        append_manual_score(
            tmp_path,
            {
                "kind": "pair",
                "item": "cat",
                "a_batch": 1,
                "b_batch": 2,
                "annotator": "我",
                "winner": "C",
            },
        )


def test_progress_flags_per_stem(tmp_path: Path) -> None:
    """进度按素材主干汇总：cat 两种都打过、dog 只有维度。"""
    workdir = tmp_path
    append_manual_score(workdir, _dimension(item="cat"))
    append_manual_score(workdir, _dimension(item="dog"))
    append_manual_score(
        workdir,
        {
            "kind": "pair",
            "item": "cat",
            "a_batch": 1,
            "b_batch": 2,
            "annotator": "我",
            "winner": "tie",
            "reason": "难分",
        },
    )
    progress = manual_progress(workdir, ["cat", "dog", "bird"])
    assert progress["cat"] == {"dimension": True, "pair": True}
    assert progress["dog"] == {"dimension": True, "pair": False}
    assert progress["bird"] == {"dimension": False, "pair": False}
