"""报告聚合与快照：从一次完成运行的三件套＋人工打分派生五层结构并落快照。

统计口径（PRD「结果报告」与 tdd 既定）：
- **报告只出原始统计量**——各读数的点估计＋Bootstrap 置信区间＋支撑计数
  （n、样本量）＋Landis-Koch 参考分级带常量；「样本不足」的标注阈值与呈现
  形态不进后端（③展示规则随报告稿走查收口）。采信程度由用户自判，不设门槛、
  不 gate 选型结论。
- **Bootstrap**：百分比区间法（5–95 分位）、B=2000、固定种子（同数据同区间，
  报告可复现）；重抽样单位＝素材主干（条目间独立假设下最自然的簇）。
- **排名**＝Bradley-Terry（MM 迭代拟合强度，平局各计 0.5），名次区间由
  「重抽条目→重拟合→记名次」的 Bootstrap 给出。基准在对战池内自然获得名次，
  各候选对基准的胜率并列呈现（「相对参照的位置」）。
- **κ**＝无加权 Cohen's kappa（按维度，judge vs 人工，校准集＝随机抽检题单上
  的最新人工记录）；「无幻觉」维度不用 κ、出混淆矩阵读数——抓中率／漏抓率＋
  报警查准 precision／误报率 FPR，同一张 2×2 表全算全列。
- **只列本次实际有的证据**：没开随机抽检就没有 κ 行；定向筛查的查准率归
  badcase 层；双序一致率随可信度层（开了双序才有）。

快照：``.dsf/eval/reports/<run_id>.json``——报告按次生成、历史可回看，记当次
配置全文与运行 ID（两级快照的报告侧）；打分批次删除时随删（归属按 batch 字段）。
"""

from __future__ import annotations

import json
import random
from pathlib import Path
from typing import cast

from .._clock import now_iso
from .._fs import atomic_write_text
from .config import KIND_BINARY, KIND_SCORE5, EvalBatchConfig
from .manual import latest_manual_scores
from .store import EvalStore

__all__ = [
    "LANDIS_KOCH_BANDS",
    "build_report",
    "latest_eval_run_dir",
    "list_reports",
    "read_report",
]


def latest_eval_run_dir(workdir: Path, seq: int) -> Path | None:
    """该打分批次最近一次运行目录（目录名字典序即时间序）；没有运行返回 None。

    坏的 run.json 跳过——「挑最近一份可读的」是清点口径，单份损坏不挡路。
    """
    store = EvalStore(workdir)
    if not store.runs_dir.is_dir():
        return None
    best: Path | None = None
    for directory in store.runs_dir.iterdir():
        marker = directory / "run.json"
        if not marker.is_file():
            continue
        try:
            loaded: object = json.loads(marker.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        matches = (
            isinstance(loaded, dict)
            and cast("dict[str, object]", loaded).get("batch") == f"e{seq}"
        )
        if matches and (best is None or directory.name > best.name):
            best = directory
    return best


#: Bootstrap 次数与随机种子（固定种子＝同数据同区间；报告可复现的口径之一）。
_BOOTSTRAP_DRAWS = 2000
_BOOTSTRAP_SEED = 20261026
_CI_LOW_PERCENT = 5
_CI_HIGH_PERCENT = 95
_RANK_BOOTSTRAP_DRAWS = 200

#: Landis-Koch 参考分级带（κ 旁的解读锚点；只展示、不判定）。
LANDIS_KOCH_BANDS: list[dict[str, object]] = [
    {"label": "slight", "low": 0.0, "high": 0.20},
    {"label": "fair", "low": 0.20, "high": 0.40},
    {"label": "moderate", "low": 0.40, "high": 0.60},
    {"label": "substantial", "low": 0.60, "high": 0.80},
    {"label": "almost perfect", "low": 0.80, "high": 1.0},
]


def _read_jsonl(path: Path) -> list[dict[str, object]]:
    """读一份运行流水（残缺尾行容忍）。"""
    if not path.exists():
        return []
    records: list[dict[str, object]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        data: object = json.loads(line)
        if isinstance(data, dict):
            records.append(cast("dict[str, object]", data))
    return records


def _mean(values: list[float]) -> float | None:
    """均值；空集返回 None。"""
    return sum(values) / len(values) if values else None


def _bootstrap_ci(values: list[float], rng: random.Random) -> dict[str, object] | None:
    """对一列数值做均值的百分比 Bootstrap 区间（5–95 分位）。"""
    if not values:
        return None
    estimates: list[float] = []
    for _ in range(_BOOTSTRAP_DRAWS):
        sample = [values[rng.randrange(len(values))] for _ in range(len(values))]
        estimate = _mean(sample)
        if estimate is not None:
            estimates.append(estimate)
    if not estimates:
        return None
    estimates.sort()
    return {
        "low": round(estimates[int(_CI_LOW_PERCENT / 100 * (len(estimates) - 1))], 4),
        "high": round(estimates[int(_CI_HIGH_PERCENT / 100 * (len(estimates) - 1))], 4),
    }


def _readout(flags: list[bool], rng: random.Random) -> dict[str, object] | None:
    """占比读数：点估计＋Bootstrap 区间＋支撑计数（n 与命中数）。"""
    if not flags:
        return None
    values = [1.0 if flag else 0.0 for flag in flags]
    point = _mean(values)
    return {
        "value": round(point, 4) if point is not None else None,
        "ci": _bootstrap_ci(values, rng),
        "n": len(flags),
        "hits": sum(flags),
    }


def _cohen_kappa(a: list[object], b: list[object]) -> float | None:
    """无加权 Cohen's kappa（两列同长分类值；类别退化或期望全对返回 None）。"""
    if not a or len(a) != len(b):
        return None
    total = len(a)
    categories = sorted({*a, *b}, key=repr)
    index = {category: i for i, category in enumerate(categories)}
    size = len(categories)
    if size < 2:
        return None
    observed = [[0] * size for _ in range(size)]
    row = [0] * size
    column = [0] * size
    for left, right in zip(a, b, strict=True):
        i, j = index[left], index[right]
        observed[i][j] += 1
        row[i] += 1
        column[j] += 1
    po = sum(observed[i][i] for i in range(size)) / total
    pe = sum(row[i] * column[i] for i in range(size)) / (total * total)
    if pe >= 1.0:
        return None
    return (po - pe) / (1 - pe)


# -- 对局聚合与 Bradley-Terry ------------------------------------------------
#
# 对局先按 (素材, 双方批次, 裁判) 归组：双序两判一致取该胜方、不一致计平局
# （各 0.5）；单序对局按那一判。归组后按 (a<b) 聚合成「场次＋a 方胜分」。


def _group_verdicts(
    pair_rows: list[dict[str, object]],
) -> dict[tuple[object, ...], dict[int, float]]:
    """按 (素材, 双方批次, 裁判) 归组判定 → 双方胜分（和为 1）。

    双序两判一致取该胜方、不一致计平局（各 0.5）——两序不一致判平局是既定口径。
    """
    grouped: dict[tuple[object, ...], tuple[tuple[int, int], list[str]]] = {}
    for row in pair_rows:
        if row.get("status") != "succeeded":
            continue
        a = row.get("a_batch")
        b = row.get("b_batch")
        if not (isinstance(a, int) and isinstance(b, int)):
            continue
        key = (row.get("item"), frozenset((a, b)), row.get("judge"))
        winner = str(row.get("winner", "tie"))
        verdict = "tie" if winner == "tie" else str(a if winner == "A" else b)
        left, right = sorted((a, b))
        grouped.setdefault(key, ((left, right), []))[1].append(verdict)
    resolved: dict[tuple[object, ...], dict[int, float]] = {}
    for key, ((left, right), verdicts) in grouped.items():
        if verdicts[0] == "tie" or (len(verdicts) > 1 and verdicts[0] != verdicts[1]):
            share = 0.5
        else:
            share = 1.0 if verdicts[0] == str(left) else 0.0
        resolved[key] = {left: share, right: 1.0 - share}
    return resolved


def _matchups(
    resolved: dict[tuple[object, ...], dict[int, float]],
) -> dict[tuple[int, int], list[float]]:
    """把归组判定聚合成 (a<b) → a 方胜分序列（每元素一场，含平局 0.5）。"""
    matchups: dict[tuple[int, int], list[float]] = {}
    for share in resolved.values():
        left, right = sorted(share)
        matchups.setdefault((left, right), []).append(share[left])
    return matchups


def _fit_bradley_terry(
    matchups: dict[tuple[int, int], list[float]], players: list[int]
) -> dict[int, float]:
    """Bradley-Terry 强度（MM 迭代；场次含平局半分）。

    Returns:
        玩家 → 强度（几何平均归一；无对局者与全平者给等强度）。
    """
    strength = dict.fromkeys(players, 1.0)
    for _ in range(50):
        wins: dict[int, float] = dict.fromkeys(players, 0.0)
        totals: dict[int, float] = dict.fromkeys(players, 0.0)
        for (a, b), shares in matchups.items():
            games = float(len(shares))
            left_wins = sum(shares)
            wins[a] += left_wins
            wins[b] += games - left_wins
            denominator = strength[a] + strength[b]
            totals[a] += games / denominator
            totals[b] += games / denominator
        updated = {
            player: wins[player] / totals[player] * strength[player]
            if totals[player] > 0
            else strength[player]
            for player in players
        }
        product = 1.0
        for value in updated.values():
            product *= max(value, 1e-12)
        geometric = product ** (1.0 / max(len(updated), 1))
        strength = {player: value / geometric for player, value in updated.items()}
    return strength


def _ranking_layer(
    pair_rows: list[dict[str, object]],
    config: EvalBatchConfig,
    rng: random.Random,
) -> dict[str, object] | None:
    """① 批次排名层：BT 拟合＋名次 Bootstrap 区间＋对基准胜率。"""
    if not config.pairwise or not pair_rows:
        return None
    resolved = _group_verdicts(pair_rows)
    if not resolved:
        return None
    keys = list(resolved)
    matchups = _matchups(resolved)
    players = sorted({batch for share in resolved.values() for batch in share})
    strength = _fit_bradley_terry(matchups, players)
    order = sorted(players, key=lambda player: (-strength[player], player))
    rank_of = {player: index + 1 for index, player in enumerate(order)}
    rank_cis: dict[int, dict[str, object]] = {}
    for player in players:
        samples: list[int] = []
        for _ in range(_RANK_BOOTSTRAP_DRAWS):
            drawn_keys = [keys[rng.randrange(len(keys))] for _ in range(len(keys))]
            drawn = {key: resolved[key] for key in drawn_keys}
            drawn_strength = _fit_bradley_terry(_matchups(drawn), players)
            drawn_order = sorted(players, key=lambda p: (-drawn_strength[p], p))
            samples.append(drawn_order.index(player) + 1)
        samples.sort()
        rank_cis[player] = {
            "rank": rank_of[player],
            "ci": {
                "low": samples[int(_CI_LOW_PERCENT / 100 * (len(samples) - 1))],
                "high": samples[int(_CI_HIGH_PERCENT / 100 * (len(samples) - 1))],
            },
        }
    vs_benchmark: dict[str, dict[str, object]] = {}
    if config.benchmark is not None and config.benchmark in strength:
        for left, right in matchups:
            if config.benchmark not in (left, right):
                continue
            shares = matchups[(left, right)]
            candidate = right if left == config.benchmark else left
            share_of_candidate = (
                sum(1.0 - s for s in shares)
                if left == config.benchmark
                else sum(shares)
            )
            vs_benchmark[f"s{candidate}"] = {
                "win_share": round(share_of_candidate / len(shares), 4),
                "n": len(shares),
            }
    return {
        "method": "bradley-terry",
        "ranking": [
            {
                "batch": f"s{player}",
                "strength": round(strength[player], 4),
                **rank_cis[player],
            }
            for player in order
        ],
        "vs_benchmark": vs_benchmark or None,
    }


def _dimension_layer(
    dimension_rows: list[dict[str, object]],
    config: EvalBatchConfig,
    rng: random.Random,
) -> dict[str, object] | None:
    """② 维度评分层：各批次均分 ± Bootstrap 区间（按条目重抽、逐条目先均）。"""
    if not config.dimension_scoring or not dimension_rows:
        return None
    score_names = [dim.name for dim in config.dimensions if dim.kind == KIND_SCORE5]
    per_batch: dict[int, dict[str, list[float]]] = {}
    for row in dimension_rows:
        if row.get("status") != "succeeded":
            continue
        scores_raw = row.get("scores")
        if not isinstance(scores_raw, dict):
            continue
        scores = cast("dict[str, object]", scores_raw)
        batch = row.get("batch")
        if not isinstance(batch, int):
            continue
        item = str(row.get("item", ""))
        values = [
            float(value)
            for name in score_names
            if isinstance((value := scores.get(name)), int)
        ]
        if not values:
            continue
        per_batch.setdefault(batch, {}).setdefault(item, []).append(
            sum(values) / len(values)
        )
    batches: list[dict[str, object]] = []
    for batch in sorted(per_batch):
        item_means = [sum(v) / len(v) for v in per_batch[batch].values()]
        point = _mean(item_means)
        batches.append(
            {
                "batch": f"s{batch}",
                "mean": round(point, 4) if point is not None else None,
                "ci": _bootstrap_ci(item_means, rng),
                "n": len(item_means),
            }
        )
    return {"batches": batches} if batches else None


def _manual_dimension_index(
    manual: list[dict[str, object]],
) -> dict[tuple[str, int], dict[str, object]]:
    """最新人工维度记录索引：(素材, 批次) → 记录。"""
    index: dict[tuple[str, int], dict[str, object]] = {}
    for record in manual:
        if record.get("kind") != "dimension":
            continue
        item = record.get("item")
        batch = record.get("batch")
        if isinstance(item, str) and isinstance(batch, int):
            index[(item, batch)] = record
    return index


def _manual_pair_index(
    manual: list[dict[str, object]],
) -> dict[tuple[str, frozenset[int]], str]:
    """最新人工对比记录索引：(素材, 双方批次) → 判定（胜方批次号或 tie）。"""
    index: dict[tuple[str, frozenset[int]], str] = {}
    for record in manual:
        if record.get("kind") != "pair":
            continue
        item = record.get("item")
        a = record.get("a_batch")
        b = record.get("b_batch")
        winner = record.get("winner")
        if (
            isinstance(item, str)
            and isinstance(a, int)
            and isinstance(b, int)
            and isinstance(winner, str)
        ):
            verdict = "tie" if winner == "tie" else str(a if winner == "A" else b)
            index[(item, frozenset((a, b)))] = verdict
    return index


def _trust_layer(
    dimension_rows: list[dict[str, object]],
    pair_rows: list[dict[str, object]],
    config: EvalBatchConfig,
    samples: dict[str, object],
    workdir: Path,
    rng: random.Random,
) -> dict[str, object]:
    """③ 裁判可信度层：只列本次实际有的证据（没开的连行都不出）。"""
    layer: dict[str, object] = {"landis_koch_bands": LANDIS_KOCH_BANDS}
    manual = latest_manual_scores(workdir)
    random_raw = samples.get("random")
    random_stems: set[str] = (
        {str(stem) for stem in cast("list[object]", random_raw)}
        if isinstance(random_raw, list)
        else set()
    )
    calibration = _manual_dimension_index(manual)
    judge_rows: dict[str, list[tuple[str, int, dict[str, object]]]] = {}
    for row in dimension_rows:
        if row.get("status") != "succeeded":
            continue
        item = row.get("item")
        batch = row.get("batch")
        scores = row.get("scores")
        if (
            isinstance(item, str)
            and isinstance(batch, int)
            and isinstance(scores, dict)
            and item in random_stems
            and (item, batch) in calibration
        ):
            judge_rows.setdefault(str(row.get("judge")), []).append(
                (item, batch, cast("dict[str, object]", scores))
            )
    per_judge: dict[str, dict[str, list[dict[str, object]]]] = {}
    for judge_id in config.judges:
        kappa_pairs: dict[str, tuple[list[object], list[object]]] = {
            dim.name: ([], []) for dim in config.dimensions if dim.kind == KIND_SCORE5
        }
        confusion: dict[str, dict[str, int]] = {}
        for item, batch, judge_scores in judge_rows.get(judge_id, []):
            manual_raw = calibration[(item, batch)].get("scores")
            if not isinstance(manual_raw, dict):
                continue
            manual_scores = cast("dict[str, object]", manual_raw)
            for dim in config.dimensions:
                judge_value = judge_scores.get(dim.name)
                manual_value = manual_scores.get(dim.name)
                if judge_value is None or manual_value is None:
                    continue
                if dim.kind == KIND_SCORE5:
                    left, right = kappa_pairs.setdefault(dim.name, ([], []))
                    left.append(judge_value)
                    right.append(manual_value)
                else:
                    counts = confusion.setdefault(
                        dim.name, {"tp": 0, "fn": 0, "fp": 0, "tn": 0}
                    )
                    flagged = judge_value == "有"
                    truth = manual_value == "有"
                    if flagged and truth:
                        counts["tp"] += 1
                    elif not flagged and truth:
                        counts["fn"] += 1
                    elif flagged and not truth:
                        counts["fp"] += 1
                    else:
                        counts["tn"] += 1
        kappas: list[dict[str, object]] = [
            {
                "dimension": name,
                "kappa": (
                    round(value, 4)
                    if (value := _cohen_kappa(left, right)) is not None
                    else None
                ),
                "n": len(left),
            }
            for name, (left, right) in kappa_pairs.items()
        ]
        confusions: list[dict[str, object]] = []
        for dim in config.dimensions:
            if dim.kind != KIND_BINARY or dim.name not in confusion:
                continue
            counts = confusion[dim.name]
            confusions.append(
                {
                    "dimension": dim.name,
                    "counts": counts,
                    "抓中率": _readout(
                        [True] * counts["tp"] + [False] * counts["fn"], rng
                    ),
                    "漏抓率": _readout(
                        [False] * counts["tp"] + [True] * counts["fn"], rng
                    ),
                    "报警查准": _readout(
                        [True] * counts["tp"] + [False] * counts["fp"], rng
                    ),
                    "误报率": _readout(
                        [True] * counts["fp"] + [False] * counts["tn"], rng
                    ),
                }
            )
        per_judge[judge_id] = {"kappa": kappas, "confusion": confusions}
    if any(judge_rows.get(judge_id) for judge_id in config.judges):
        layer["judges"] = per_judge
    # 双序一致率（开了双序才有）：同一 (素材, 对, 裁判) 两条判定一致的比例。
    if (
        config.pairwise
        and config.pairwise_settings is not None
        and config.pairwise_settings.dual_order != "none"
    ):
        grouped: dict[tuple[object, ...], list[str]] = {}
        for row in pair_rows:
            if row.get("status") != "succeeded":
                continue
            key = (
                row.get("item"),
                frozenset((row.get("a_batch"), row.get("b_batch"))),
                row.get("judge"),
            )
            grouped.setdefault(key, []).append(str(row.get("winner", "")))
        flags = [
            winners[0] == winners[1]
            for winners in grouped.values()
            if len(winners) >= 2
        ]
        agreement = _readout(flags, rng)
        if agreement is not None:
            layer["dual_order_agreement"] = agreement
    # 对比人工一致率（人工 pair 记录 vs 同题 judge 判定，逐判对齐）。
    if config.human.pairwise_manual and pair_rows:
        manual_pairs = _manual_pair_index(manual)
        agree_flags: list[bool] = []
        for row in pair_rows:
            if row.get("status") != "succeeded":
                continue
            item = row.get("item")
            a = row.get("a_batch")
            b = row.get("b_batch")
            if not (
                isinstance(item, str) and isinstance(a, int) and isinstance(b, int)
            ):
                continue
            manual_verdict = manual_pairs.get((item, frozenset((a, b))))
            if manual_verdict is None:
                continue
            winner = str(row.get("winner", "tie"))
            judge_verdict = "tie" if winner == "tie" else str(a if winner == "A" else b)
            agree_flags.append(judge_verdict == manual_verdict)
        agreement = _readout(agree_flags, rng)
        if agreement is not None:
            layer["pairwise_agreement"] = agreement
    return layer


def _badcase_layer(
    dimension_rows: list[dict[str, object]],
    samples: dict[str, object],
    workdir: Path,
    rng: random.Random,
) -> dict[str, object] | None:
    """④ badcase 层：judge 幻觉条目＋人工低分条目＋定向筛查查准率与清单。

    查准率＝定向题单里「人也认为有问题」的比例（人工低分 ≤2 或幻觉判「有」）；
    还没打人工分的定向条目不计入（分母＝已打的那些）。
    """
    hallucination: dict[str, list[str]] = {}
    for row in dimension_rows:
        if row.get("status") != "succeeded":
            continue
        scores = row.get("scores")
        if not isinstance(scores, dict):
            continue
        score_map = cast("dict[str, object]", scores)
        flagged = [
            f"s{row.get('batch')}·{name}"
            for name, value in score_map.items()
            if value == "有"
        ]
        if flagged:
            hallucination.setdefault(str(row.get("item", "")), []).extend(flagged)
    manual = latest_manual_scores(workdir)
    manual_low: dict[str, str] = {}
    for record in manual:
        if record.get("kind") != "dimension":
            continue
        scores = record.get("scores")
        if not isinstance(scores, dict):
            continue
        score_map = cast("dict[str, object]", scores)
        lows = [
            name
            for name, value in score_map.items()
            if (isinstance(value, int) and value <= 2) or value == "有"
        ]
        if lows:
            manual_low[str(record.get("item", ""))] = "、".join(sorted(set(lows)))
    layer: dict[str, object] = {
        "judge_hallucination": hallucination,
        "manual_low_scores": manual_low,
    }
    targeted = samples.get("targeted")
    if isinstance(targeted, dict):
        items = cast("dict[str, object]", targeted).get("items")
        if isinstance(items, list):
            stems = [str(stem) for stem in cast("list[object]", items)]
            scored_stems = {item for item, _ in _manual_dimension_index(manual)}
            flags = [stem in manual_low for stem in stems if stem in scored_stems]
            layer["targeted"] = {
                "items": stems,
                "precision": _readout(flags, rng),
            }
    return layer


def _reproducibility_layer(
    config: EvalBatchConfig, run_record: dict[str, object]
) -> dict[str, object]:
    """⑤ 可复现层：来源与许可、裁判快照、工具版本、对数与实际调用数分列。"""
    pair_count = 0
    dual_pairs = 0
    pairs_stat = run_record.get("pairs")
    if isinstance(pairs_stat, dict):
        stat = cast("dict[str, object]", pairs_stat)
        raw_pairs = stat.get("pairs", 0)
        raw_dual = stat.get("dual_pairs", 0)
        pair_count = raw_pairs if isinstance(raw_pairs, int) else 0
        dual_pairs = raw_dual if isinstance(raw_dual, int) else 0
    counters = run_record.get("counters")
    raw_planned = (
        cast("dict[str, object]", counters).get("planned")
        if isinstance(counters, dict)
        else None
    )
    planned = raw_planned if isinstance(raw_planned, int) else None
    return {
        "dataset_source": config.dataset_source,
        "dataset_license": config.dataset_license,
        "config": run_record.get("config"),
        "judges": run_record.get("judges"),
        "dsf_version": run_record.get("dsf_version"),
        "pairs": pair_count,
        "dual_pairs": dual_pairs,
        "calls": planned,
    }


def build_report(workdir: Path, seq: int, run_id: str) -> dict[str, object]:
    """从一次运行的落盘产物聚合五层报告并写快照（返回完整报告字典）。

    Raises:
        FileNotFoundError: 运行目录或运行记录不存在。
        ValueError: 运行记录不属于该打分批次、或记录损坏。
    """
    store = EvalStore(workdir)
    run_dir = store.runs_dir / run_id
    loaded: object = json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
    if not isinstance(loaded, dict):
        raise TypeError(f"运行记录损坏（{run_dir}）。")
    record = cast("dict[str, object]", loaded)
    if record.get("batch") != f"e{seq}":
        raise ValueError(f"运行 {run_id} 不属于打分批次 e{seq}。")
    config = EvalBatchConfig.from_json(record.get("config"))
    dimension_rows = _read_jsonl(run_dir / "scores.jsonl")
    pair_rows = _read_jsonl(run_dir / "pairs.jsonl")
    samples: dict[str, object] = {}
    samples_path = run_dir / "samples.json"
    if samples_path.exists():
        loaded_samples: object = json.loads(samples_path.read_text(encoding="utf-8"))
        if isinstance(loaded_samples, dict):
            samples = cast("dict[str, object]", loaded_samples)
    rng = random.Random(_BOOTSTRAP_SEED)  # noqa: S311 — 统计抽样非加密用途
    report: dict[str, object] = {
        "report_id": run_id,
        "batch": f"e{seq}",
        "run_id": run_id,
        "generated_at": now_iso(),
        "status": record.get("status"),
        "counters": record.get("counters"),
        "layers": {
            "ranking": _ranking_layer(pair_rows, config, rng),
            "dimensions": _dimension_layer(dimension_rows, config, rng),
            "trust": _trust_layer(
                dimension_rows, pair_rows, config, samples, workdir, rng
            ),
            "badcase": _badcase_layer(dimension_rows, samples, workdir, rng),
            "reproducibility": _reproducibility_layer(config, record),
        },
    }
    atomic_write_text(
        store.reports_dir / f"{run_id}.json",
        json.dumps(report, ensure_ascii=False, indent=2),
    )
    return report


def list_reports(workdir: Path, seq: int) -> list[dict[str, object]]:
    """某打分批次的报告快照摘要（最新在前；坏文件跳过——清点不因单份损坏挡路）。"""
    store = EvalStore(workdir)
    summaries: list[dict[str, object]] = []
    if not store.reports_dir.is_dir():
        return summaries
    for path in sorted(store.reports_dir.glob("*.json"), reverse=True):
        try:
            loaded: object = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(loaded, dict):
            continue
        record = cast("dict[str, object]", loaded)
        if record.get("batch") != f"e{seq}":
            continue
        summaries.append(
            {
                "report_id": record.get("report_id"),
                "run_id": record.get("run_id"),
                "generated_at": record.get("generated_at"),
                "status": record.get("status"),
            }
        )
    return summaries


def read_report(workdir: Path, seq: int, report_id: str) -> dict[str, object]:
    """读一份报告快照全文。

    Raises:
        FileNotFoundError: 报告不存在。
        ValueError: 报告不属于该打分批次、或快照损坏。
    """
    path = EvalStore(workdir).reports_dir / f"{report_id}.json"
    loaded: object = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(loaded, dict):
        raise TypeError(f"报告快照损坏（{path}）。")
    record = cast("dict[str, object]", loaded)
    if record.get("batch") != f"e{seq}":
        raise ValueError(f"报告 {report_id} 不属于打分批次 e{seq}。")
    return record
