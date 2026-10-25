"""人工打分存取：追加式记录＋每键取最近一条的读视图。

口径（PRD「人工打分」与 tdd「三、数据与存储」）：评分记录**绑素材 × 批次 ×
条目 × 标注者、不绑打分批次配置**——改配置后仍作校准集、抽检进度保留，删除
打分批次也不随删。追加式不可变：改分＝追加新记录，读取按「每键最近一条有效」。

两种记录形状（与 judge 流水对偶）：
- ``dimension``：一条候选 caption 的维度打分（item × batch × 标注者）；
- ``pair``：一对候选的对比判定（item × a_batch/b_batch × 标注者，A/B 为位置
  标签）。

低分必填理由（人工低分必填、高分选填——PRD 规则，五档评分 ≤2 视为低分）。
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import cast

from .._clock import now_iso
from .errors import EvalConfigError
from .store import EvalStore

__all__ = [
    "append_manual_score",
    "latest_manual_scores",
    "manual_progress",
    "read_manual_scores",
]

#: 五档评分的低分线（≤2 必填理由）。
LOW_SCORE_THRESHOLD = 2

_WINNERS = ("A", "B", "tie")


def _validate_scores(scores: object) -> dict[str, int | str]:
    """校验维度分字典：非空、名字非空、值域（1–5 整数或「有／无」）。"""
    if not isinstance(scores, dict) or not scores:
        raise EvalConfigError("人工维度打分至少要有一个维度的分数。")
    cleaned: dict[str, int | str] = {}
    for name, value in cast("dict[str, object]", scores).items():
        if not str(name).strip():
            raise EvalConfigError("维度名不能为空。")
        if isinstance(value, bool):
            raise EvalConfigError(f"维度「{name}」的分数类型不合法。")
        if isinstance(value, int):
            if not 1 <= value <= 5:
                raise EvalConfigError(
                    f"维度「{name}」的分数须为 1–5 的整数，实际为 {value}。"
                )
        elif value not in ("有", "无"):
            raise EvalConfigError(
                f"维度「{name}」的判定须为「有」或「无」，实际为 {value!r}。"
            )
        cleaned[name] = value
    return cleaned


def validate_manual_score(record: dict[str, object]) -> None:
    """校验一条人工打分记录的形状与规则（就地不改值）。

    Raises:
        EvalConfigError: 形状不对或规则不过（低分缺理由等），消息可操作。
    """
    kind = record.get("kind")
    item = record.get("item")
    annotator = record.get("annotator")
    reason = record.get("reason")
    if not isinstance(item, str) or not item.strip():
        raise EvalConfigError("素材主干（item）不能为空。")
    if not isinstance(annotator, str) or not annotator.strip():
        raise EvalConfigError("标注者不能为空（匿名也请给个标识，如「匿名」）。")
    if reason is not None and not isinstance(reason, str):
        raise EvalConfigError("理由须为文本。")
    reason_text = reason if isinstance(reason, str) else ""
    if kind == "dimension":
        batch = record.get("batch")
        if not isinstance(batch, int) or isinstance(batch, bool) or batch < 1:
            raise EvalConfigError("维度打分必须指明批次（sN 的 N）。")
        scores = _validate_scores(record.get("scores"))
        if (
            any(
                isinstance(value, int) and value <= LOW_SCORE_THRESHOLD
                for value in scores.values()
            )
            and not reason_text.strip()
        ):
            raise EvalConfigError(
                f"「{item}」有人工低分（≤{LOW_SCORE_THRESHOLD}），理由必填——"
                "低分要能复盘。"
            )
    elif kind == "pair":
        a_batch = record.get("a_batch")
        b_batch = record.get("b_batch")
        winner = record.get("winner")
        for name, value in (("a_batch", a_batch), ("b_batch", b_batch)):
            if not isinstance(value, int) or isinstance(value, bool) or value < 1:
                raise EvalConfigError(f"对比判定必须指明双方批次（{name}）。")
        if a_batch == b_batch:
            raise EvalConfigError("对比判定的双方不能是同一个批次。")
        if winner not in _WINNERS:
            raise EvalConfigError(f"判定结果须为 A、B 或 tie，实际为 {winner!r}。")
    else:
        raise EvalConfigError(
            "人工打分类型只能是维度打分（dimension）或对比判定（pair）。"
        )


def append_manual_score(workdir: Path, record: dict[str, object]) -> dict[str, object]:
    """校验并追加一条人工打分（改分＝再追加一条，读取按每键最近一条）。

    Returns:
        落盘的完整记录（补齐 recorded_at）。
    """
    validate_manual_score(record)
    stored = {**record, "recorded_at": now_iso()}
    line = (json.dumps(stored, ensure_ascii=False) + "\n").encode("utf-8")
    path = EvalStore(workdir).manual_scores_file
    with path.open("a+b") as handle:
        handle.seek(0)
        raw = handle.read()
        if raw and not raw.endswith(b"\n"):
            handle.truncate(raw.rfind(b"\n") + 1)
        handle.seek(0, os.SEEK_END)
        handle.write(line)
        handle.flush()
        os.fsync(handle.fileno())
    return stored


def read_manual_scores(workdir: Path) -> list[dict[str, object]]:
    """读全部人工打分记录（追加序＝时间正序；残缺尾行容忍、中间坏行 fail loud）。"""
    path = EvalStore(workdir).manual_scores_file
    if not path.exists():
        return []
    raw = path.read_bytes()
    if raw and not raw.endswith(b"\n"):
        raw = raw[: raw.rfind(b"\n") + 1]
    records: list[dict[str, object]] = []
    for line in raw.splitlines():
        if not line.strip():
            continue
        data: object = json.loads(line)
        if not isinstance(data, dict):
            raise EvalConfigError(
                "人工打分记录文件损坏（有一条不是对象）——请检查 "
                ".dsf/eval/manual-scores.jsonl。"
            )
        records.append(cast("dict[str, object]", data))
    return records


def manual_score_key(record: dict[str, object]) -> tuple[object, ...]:
    """一条记录的键（素材 × 批次 × 标注者；pair 含双方批次）。"""
    base = (record.get("kind"), record.get("item"), record.get("annotator"))
    if record.get("kind") == "pair":
        return (
            *base,
            frozenset((record.get("a_batch"), record.get("b_batch"))),
        )
    return (*base, record.get("batch"))


def latest_manual_scores(workdir: Path) -> list[dict[str, object]]:
    """每键取最近一条有效记录（改分后旧记录不再参与视图，但仍留痕在文件里）。"""
    latest: dict[tuple[object, ...], dict[str, object]] = {}
    for record in read_manual_scores(workdir):  # 追加序，后写覆盖先写
        latest[manual_score_key(record)] = record
    return list(latest.values())


def manual_progress(workdir: Path, stems: list[str]) -> dict[str, dict[str, bool]]:
    """按素材主干汇总人工进度：该素材是否已有维度打分 / 对比判定（任一批次）。"""
    progress = {stem: {"dimension": False, "pair": False} for stem in stems}
    for record in latest_manual_scores(workdir):
        stem = record.get("item")
        if not isinstance(stem, str) or stem not in progress:
            continue
        kind = record.get("kind")
        if kind in ("dimension", "pair"):
            progress[stem][cast("str", kind)] = True
    return progress
