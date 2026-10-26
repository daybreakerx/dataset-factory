"""报告聚合与快照：从一次完成运行的三件套＋人工打分派生五层结构并落快照。

统计口径（PRD「结果报告」与 tdd 既定）：

- **报告只出原始统计量**——各读数的点估计＋Bootstrap 置信区间＋支撑计数
  （n、样本量）＋Landis-Koch 参考分级带常量；「样本不足」的标注阈值与呈现
  形态不进后端（③展示规则随报告稿走查收口）。采信程度由用户自判，不设门槛、
  不 gate 选型结论。
- **Bootstrap**：百分比区间法（5–95 分位）、B=2000、固定种子（同数据同区间，
  报告可复现）；重抽样单位＝素材主干（条目间独立假设下最自然的簇）。κ 与
  标注者间一致率同样按条目聚簇重抽；种子按指标名从稳定哈希派生，增删某个
  读数不会挪动其他读数的区间。
- **排名**＝Bradley-Terry（MM 迭代 50 轮、几何平均归一；平局各计 0.5），拟合
  带岭正则与少量伪计数——全胜／单场／链式／断开分量等任意对局图都返回有限
  强度，不产生 nan／inf。名次区间＝「按条目重抽（同一条目的多局整簇进出、
  保留重数）→ 重拟合 → 记名次」的 Bootstrap；强度在容差内相等时取平均名次，
  对局图含多个连通分量时排名层标 ``comparable: false`` 并列出分量（展示仍按
  名次排，但跨分量不可比）。基准在对战池内自然获得名次，各候选对基准的胜率
  并列呈现。
- **κ**＝无加权 Cohen's kappa（按维度，judge vs 人工；校准集＝随机抽检题单，
  或人工全量时的参评条目全集；跨标注者取 ``recorded_at`` 最新的一条）；每个
  κ 读数随附按条目聚簇的 Bootstrap 区间与 n。多标注者时另出标注者间一致率
  （维度分／对比判定，按重叠题对算 exact agreement；只有一个标注者时不出）。
  「无幻觉」维度不用 κ、出混淆矩阵读数——抓中率／漏抓率＋报警查准 precision／
  误报率 FPR，同一张 2×2 表全算全列。
- **只列本次实际有的证据**：没开随机抽检（且非全量）就没有 κ 行；定向筛查的
  查准率归 badcase 层；双序一致率随可信度层（开了双序才有），按「两序判定是否
  指向同一批次」计（不直接比 A/B 位置标签）。
- **badcase 层**：人工低分记录按 (素材, 批次) 复合键落表，定向查准率在题单只有
  素材主干、无法精确到批次时按「该素材所有已打分批次都低才算命中」的保守口径，
  不跨批次串用。

快照：``.dsf/eval/reports/<run_id>.json``——报告按次生成、历史可回看，记当次
配置全文与运行 ID（两级快照的报告侧）；打分批次删除时随删（归属按 batch 字段）。
运行产物损坏（read_report／build_report 读到坏 JSON、坏流水行）统一抛
:class:`EvalReportCorruptedError`；运行或报告标识做白名单＋目录包含校验，越界按
非法输入拒绝。
"""

from __future__ import annotations

import json
import math
import random
import re
import zlib
from collections.abc import Iterable
from pathlib import Path
from typing import cast

from .._clock import now_iso
from .._fs import atomic_write_text
from .config import KIND_BINARY, KIND_SCORE5, EvalBatchConfig
from .errors import EvalConfigCorruptedError, EvalError, EvalReportCorruptedError
from .manual import LOW_SCORE_THRESHOLD, latest_manual_scores, manual_score_key
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

#: BT 数值稳定参数：每名选手少量伪胜利（伪计数）＋岭正则。MM 更新
#: ``s' = (W + 伪胜利) / (D + 岭正则)``——全胜时强度有上界 ``(场数 + 伪胜利) / 岭正则``，
#: 全负时下界为正，任意对局图都不会除零或发散。
_BT_ITERATIONS = 50
_BT_PSEUDO_WINS = 0.5
_BT_RIDGE = 0.5

#: 名次容差：强度相对差在此以内视为并列（取平均名次）。
_TIE_TOLERANCE = 1e-9

#: 运行／报告标识的白名单：字母数字开头，只含字母数字与 ``._-``（挡住路径分隔与 ``..``）。
_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*")

#: Landis-Koch 参考分级带（κ 旁的解读锚点；只展示、不判定）。
#: 相邻带端点不重叠：0.40 落 fair、0.41 落 moderate，0.60 落 moderate、0.61 落 substantial。
LANDIS_KOCH_BANDS: list[dict[str, object]] = [
    {"label": "poor", "low": -1.0, "high": -0.01},
    {"label": "slight", "low": 0.0, "high": 0.20},
    {"label": "fair", "low": 0.21, "high": 0.40},
    {"label": "moderate", "low": 0.41, "high": 0.60},
    {"label": "substantial", "low": 0.61, "high": 0.80},
    {"label": "almost perfect", "low": 0.81, "high": 1.0},
]


def _report_corrupted(path: Path, detail: str) -> EvalReportCorruptedError:
    """构造一条「报告数据损坏」异常（消息带文件与修法）。"""
    return EvalReportCorruptedError(
        f"报告数据损坏（{path}：{detail}）——请检查该运行目录或报告快照，"
        "必要时重跑该次打分重新生成。"
    )


def _read_json_object(path: Path) -> dict[str, object]:
    """读一个 JSON 对象文件；读不了、不是合法 JSON、根不是对象都按损坏处理。

    Raises:
        EvalReportCorruptedError: 文件缺失以外的任何读取／解析／形状问题。
    """
    try:
        raw = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise _report_corrupted(path, "无法读取") from exc
    try:
        data: object = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise _report_corrupted(path, "不是合法 JSON") from exc
    if not isinstance(data, dict):
        raise _report_corrupted(path, "根不是对象")
    return cast("dict[str, object]", data)


def _read_jsonl(path: Path) -> list[dict[str, object]]:
    """读一份运行流水：容忍残缺尾行（崩溃残留），中间坏行按损坏上报。

    Raises:
        EvalReportCorruptedError: 中间行不是合法 JSON 或不是对象。
    """
    if not path.exists():
        return []
    try:
        raw = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise _report_corrupted(path, "无法读取") from exc
    lines = raw.splitlines()
    records: list[dict[str, object]] = []
    for index, line in enumerate(lines):
        if not line.strip():
            continue
        try:
            data: object = json.loads(line)
        except json.JSONDecodeError as exc:
            if index == len(lines) - 1 and not raw.endswith(("\n", "\r")):
                # 残缺尾行＝写入中途崩溃的残留，丢弃即可（后续追加会先截断它）。
                break
            raise _report_corrupted(path, f"第 {index + 1} 行不是合法 JSON") from exc
        if not isinstance(data, dict):
            raise _report_corrupted(path, f"第 {index + 1} 行不是对象")
        records.append(cast("dict[str, object]", data))
    return records


def _read_latest_manual(workdir: Path) -> list[dict[str, object]]:
    """读生成报告时有效的人工打分（每键最近一条；损坏映射为报告域异常）。"""
    try:
        return latest_manual_scores(workdir)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, EvalError) as exc:
        raise EvalReportCorruptedError(
            "人工打分记录损坏（.dsf/eval/manual-scores.jsonl）——请检查该文件后重试。"
        ) from exc


def _safe_child(directory: Path, name: str, *, suffix: str = "", kind: str) -> Path:
    """把标识拼成目录下的子路径：白名单字符＋ resolve 后父目录包含校验。

    Raises:
        ValueError: 标识含非法字符、或解析后越出数据目录。
    """
    if _ID_PATTERN.fullmatch(name) is None:
        raise ValueError(
            f"{kind}「{name}」不合法——只允许字母、数字、点、下划线、连字符，"
            "且以字母或数字开头。"
        )
    root = directory.resolve()
    path = (root / f"{name}{suffix}").resolve()
    if path.parent != root:
        raise ValueError(f"{kind}「{name}」越出数据目录——请检查标识。")
    return path


def _mean(values: list[float]) -> float | None:
    """均值；空集返回 None。"""
    return sum(values) / len(values) if values else None


def _metric_rng(name: str) -> random.Random:
    """按指标名派生独立固定种子（crc32 稳定哈希，不随 Python 进程哈希盐漂移）。"""
    return random.Random(  # noqa: S311 — 统计抽样非加密用途
        _BOOTSTRAP_SEED ^ (zlib.crc32(name.encode("utf-8")) & 0xFFFFFFFF)
    )


def _percentile_value(ordered: list[float], percent: int) -> float:
    """已排序序列的百分比取值（百分比法的分位点）。"""
    return ordered[int(percent / 100 * (len(ordered) - 1))]


def _bootstrap_mean_ci(
    values: list[float], rng: random.Random
) -> dict[str, object] | None:
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
        "low": round(_percentile_value(estimates, _CI_LOW_PERCENT), 4),
        "high": round(_percentile_value(estimates, _CI_HIGH_PERCENT), 4),
    }


def _bootstrap_ratio_ci(
    groups: dict[str, list[bool]], rng: random.Random
) -> dict[str, object] | None:
    """按簇（条目）重抽的比例区间：整簇进出、保留重数，再算命中占比。"""
    keys = [key for key, flags in groups.items() if flags]
    if not keys:
        return None
    estimates: list[float] = []
    for _ in range(_BOOTSTRAP_DRAWS):
        hits = 0
        total = 0
        for _ in range(len(keys)):
            flags = groups[keys[rng.randrange(len(keys))]]
            hits += sum(flags)
            total += len(flags)
        if total:
            estimates.append(hits / total)
    if not estimates:
        return None
    estimates.sort()
    return {
        "low": round(_percentile_value(estimates, _CI_LOW_PERCENT), 4),
        "high": round(_percentile_value(estimates, _CI_HIGH_PERCENT), 4),
    }


def _readout(flags: list[bool], rng: random.Random) -> dict[str, object] | None:
    """占比读数：点估计＋Bootstrap 区间＋支撑计数（n 与命中数）。"""
    if not flags:
        return None
    values = [1.0 if flag else 0.0 for flag in flags]
    point = _mean(values)
    return {
        "value": round(point, 4) if point is not None else None,
        "ci": _bootstrap_mean_ci(values, rng),
        "n": len(flags),
        "hits": sum(flags),
    }


def _cluster_readout(
    groups: dict[str, list[bool]], rng: random.Random
) -> dict[str, object] | None:
    """按条目聚簇重抽的占比读数（点估计＋按簇 CI＋n 与命中数）。"""
    flags = [flag for group in groups.values() for flag in group]
    if not flags:
        return None
    hits = sum(flags)
    return {
        "value": round(hits / len(flags), 4),
        "ci": _bootstrap_ratio_ci(groups, rng),
        "n": len(flags),
        "hits": hits,
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


def _kappa_bootstrap_ci(
    pairs_by_item: dict[str, list[tuple[object, object]]], rng: random.Random
) -> dict[str, object] | None:
    """κ 的条目聚簇 Bootstrap 区间（重抽条目、重算 κ、取 5–95 分位）。"""
    keys = [key for key, pairs in pairs_by_item.items() if pairs]
    if not keys:
        return None
    estimates: list[float] = []
    for _ in range(_BOOTSTRAP_DRAWS):
        left: list[object] = []
        right: list[object] = []
        for _ in range(len(keys)):
            for pair_left, pair_right in pairs_by_item[keys[rng.randrange(len(keys))]]:
                left.append(pair_left)
                right.append(pair_right)
        value = _cohen_kappa(left, right)
        if value is not None:
            estimates.append(value)
    if not estimates:
        return None
    estimates.sort()
    return {
        "low": round(_percentile_value(estimates, _CI_LOW_PERCENT), 4),
        "high": round(_percentile_value(estimates, _CI_HIGH_PERCENT), 4),
    }


# -- 对局聚合与 Bradley-Terry ------------------------------------------------
#
# 对局先按 (素材, 双方批次, 裁判) 归组：双序两判一致取该胜方、不一致计平局
# （各 0.5）；单序对局按那一判。归组后按 (a<b) 聚合成「场次＋a 方胜分」。


def _resolve_winner(row: dict[str, object]) -> str | None:
    """把一行的位置标签解析成批次号串（tie 原样）；形状不对返回 None。"""
    a = row.get("a_batch")
    b = row.get("b_batch")
    if not (isinstance(a, int) and isinstance(b, int)):
        return None
    return _manual_verdict(a, b, row.get("winner"))


def _manual_verdict(a: int, b: int, winner: object) -> str | None:
    """位置标签（A／B／tie）→ 胜方批次号串或 tie；非法标签返回 None。"""
    if winner == "tie":
        return "tie"
    if winner == "A":
        return str(a)
    if winner == "B":
        return str(b)
    return None


def _group_verdicts(
    pair_rows: list[dict[str, object]],
) -> dict[tuple[object, ...], dict[int, float]]:
    """按 (素材, 双方批次, 裁判) 归组判定 → 双方胜分（和为 1）。

    双序两判解析成批次号后比较：一致取该胜方、不一致计平局（各 0.5）——
    两序不一致判平局是既定口径，比较批次而非 A/B 位置标签。
    """
    grouped: dict[tuple[object, ...], tuple[tuple[int, int], list[str]]] = {}
    for row in pair_rows:
        if row.get("status") != "succeeded":
            continue
        a = row.get("a_batch")
        b = row.get("b_batch")
        if not (isinstance(a, int) and isinstance(b, int)):
            continue
        verdict = _resolve_winner(row)
        if verdict is None:
            continue
        key = (row.get("item"), frozenset((a, b)), row.get("judge"))
        left, right = sorted((a, b))
        grouped.setdefault(key, ((left, right), []))[1].append(verdict)
    resolved: dict[tuple[object, ...], dict[int, float]] = {}
    for key, ((left, right), verdicts) in grouped.items():
        first = verdicts[0]
        consistent = all(verdict == first for verdict in verdicts[1:])
        if first == "tie" or not consistent:
            share = 0.5
        else:
            share = 1.0 if first == str(left) else 0.0
        resolved[key] = {left: share, right: 1.0 - share}
    return resolved


def _matchups(
    resolved: Iterable[dict[int, float]],
) -> dict[tuple[int, int], list[float]]:
    """把逐场胜分聚合成 (a<b) → a 方胜分序列（每元素一场，含平局 0.5）。"""
    matchups: dict[tuple[int, int], list[float]] = {}
    for share in resolved:
        left, right = sorted(share)
        matchups.setdefault((left, right), []).append(share[left])
    return matchups


def _fit_bradley_terry(
    matchups: dict[tuple[int, int], list[float]], players: list[int]
) -> dict[int, float]:
    """Bradley-Terry 强度（MM 迭代；场次含平局半分；伪计数＋岭正则保数值稳定）。

    正则化后的 MM 更新为 ``s' = (W + 伪胜利) / (D + 岭正则)``：分子恒正、分母
    恒正，因此全胜／全负／单场／链式／断开分量都不会出现除零或 nan；强度上界
    是 ``(场数 + 伪胜利) / 岭正则``。归一化在对数空间做（几何平均），避免大
    强度连乘溢出。

    Args:
        matchups: (a<b) → a 方胜分序列。
        players: 参评玩家（批次号）。

    Returns:
        玩家 → 有限正强度（几何平均归一；无对局者与全平者给等强度）。
    """
    strength = dict.fromkeys(players, 1.0)
    for _ in range(_BT_ITERATIONS):
        wins: dict[int, float] = dict.fromkeys(players, _BT_PSEUDO_WINS)
        totals: dict[int, float] = dict.fromkeys(players, _BT_RIDGE)
        for (a, b), shares in matchups.items():
            games = float(len(shares))
            left_wins = sum(shares)
            wins[a] += left_wins
            wins[b] += games - left_wins
            denominator = strength[a] + strength[b]
            totals[a] += games / denominator
            totals[b] += games / denominator
        updated = {player: wins[player] / totals[player] for player in players}
        logs = [math.log(value) for value in updated.values()]
        shift = sum(logs) / max(len(logs), 1)
        strength = {
            player: math.exp(max(min(math.log(value) - shift, 690.0), -690.0))
            for player, value in updated.items()
        }
    return strength


def _within_tie(left: float, right: float) -> bool:
    """两强度是否在容差内相等（视为并列）。"""
    return abs(left - right) <= _TIE_TOLERANCE * max(1.0, abs(left), abs(right))


def _strength_ranks(players: list[int], strength: dict[int, float]) -> dict[int, float]:
    """按强度给名次：并列（容差内）取平均名次，否则 1..N。"""
    ordered = sorted(players, key=lambda player: (-strength[player], player))
    ranks: dict[int, float] = {}
    start = 0
    while start < len(ordered):
        end = start + 1
        while end < len(ordered) and _within_tie(
            strength[ordered[end]], strength[ordered[start]]
        ):
            end += 1
        average = (start + 1 + end) / 2
        value = int(average) if average.is_integer() else average
        for player in ordered[start:end]:
            ranks[player] = float(value)
        start = end
    return ranks


def _matchup_components(
    players: list[int], matchups: dict[tuple[int, int], list[float]]
) -> list[list[int]]:
    """对局图的连通分量（按批号升序；分量内与分量间都升序）。"""
    adjacency: dict[int, set[int]] = {player: set() for player in players}
    for a, b in matchups:
        adjacency[a].add(b)
        adjacency[b].add(a)
    seen: set[int] = set()
    components: list[list[int]] = []
    for player in sorted(players):
        if player in seen:
            continue
        stack = [player]
        component: list[int] = []
        while stack:
            node = stack.pop()
            if node in seen:
                continue
            seen.add(node)
            component.append(node)
            stack.extend(adjacency[node] - seen)
        components.append(sorted(component))
    return components


def _item_clusters(
    resolved: dict[tuple[object, ...], dict[int, float]],
) -> dict[str, list[dict[int, float]]]:
    """按素材主干把「场次胜分」聚簇（同一条目的多局必须整簇抽）。"""
    clusters: dict[str, list[dict[int, float]]] = {}
    for key, share in resolved.items():
        clusters.setdefault(str(key[0]), []).append(share)
    return clusters


def _draw_item_records(
    clusters: dict[str, list[dict[int, float]]], rng: random.Random
) -> list[dict[int, float]]:
    """按条目有放回重抽（重数保留：同一条目的多局整簇进出）。"""
    items = sorted(clusters)
    drawn: list[dict[int, float]] = []
    for _ in range(len(items)):
        drawn.extend(clusters[items[rng.randrange(len(items))]])
    return drawn


def _ranking_layer(
    pair_rows: list[dict[str, object]], config: EvalBatchConfig
) -> dict[str, object] | None:
    """① 批次排名层：BT 拟合＋按条目重抽的名次区间＋连通分量＋对基准胜率。"""
    if not config.pairwise or not pair_rows:
        return None
    resolved = _group_verdicts(pair_rows)
    if not resolved:
        return None
    records = list(resolved.values())
    matchups = _matchups(records)
    players = sorted({batch for share in records for batch in share})
    strength = _fit_bradley_terry(matchups, players)
    ranks = _strength_ranks(players, strength)
    clusters = _item_clusters(resolved)
    rng = _metric_rng("ranking")
    boot_ranks: dict[int, list[float]] = {player: [] for player in players}
    for _ in range(_RANK_BOOTSTRAP_DRAWS):
        drawn = _draw_item_records(clusters, rng)
        drawn_strength = _fit_bradley_terry(_matchups(drawn), players)
        drawn_ranks = _strength_ranks(players, drawn_strength)
        for player in players:
            boot_ranks[player].append(drawn_ranks[player])
    ranking: list[dict[str, object]] = []
    for player in sorted(players, key=lambda item: (ranks[item], item)):
        samples = sorted(boot_ranks[player])
        ranking.append(
            {
                "batch": f"s{player}",
                "strength": round(strength[player], 4),
                "rank": ranks[player],
                "ci": {
                    "low": _percentile_value(samples, _CI_LOW_PERCENT),
                    "high": _percentile_value(samples, _CI_HIGH_PERCENT),
                },
            }
        )
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
    components = _matchup_components(players, matchups)
    return {
        "method": "bradley-terry",
        "comparable": len(components) == 1,
        "components": [
            [f"s{batch}" for batch in component] for component in components
        ],
        "ranking": ranking,
        "vs_benchmark": vs_benchmark or None,
    }


def _dimension_layer(
    dimension_rows: list[dict[str, object]], config: EvalBatchConfig
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
                "ci": _bootstrap_mean_ci(
                    item_means, _metric_rng(f"dimensions.s{batch}")
                ),
                "n": len(item_means),
            }
        )
    return {"batches": batches} if batches else None


def _recorded_at(record: dict[str, object]) -> str:
    """记录的人工打分时刻（ISO 串；缺失给空串——排序时最早）。"""
    value = record.get("recorded_at")
    return value if isinstance(value, str) else ""


def _manual_dimension_index(
    manual: list[dict[str, object]],
) -> dict[tuple[str, int], dict[str, object]]:
    """最新人工维度记录索引：(素材, 批次) → 记录（跨标注者按 recorded_at 取最新）。"""
    index: dict[tuple[str, int], dict[str, object]] = {}
    for record in manual:
        if record.get("kind") != "dimension":
            continue
        item = record.get("item")
        batch = record.get("batch")
        if not (
            isinstance(item, str)
            and isinstance(batch, int)
            and not isinstance(batch, bool)
        ):
            continue
        key = (item, batch)
        previous = index.get(key)
        if previous is None or _recorded_at(record) >= _recorded_at(previous):
            index[key] = record
    return index


def _manual_pair_index(
    manual: list[dict[str, object]],
) -> dict[tuple[str, frozenset[int]], str]:
    """最新人工对比记录索引：(素材, 双方批次) → 判定（胜方批次号串或 tie）。"""
    index: dict[tuple[str, frozenset[int]], tuple[str, dict[str, object]]] = {}
    for record in manual:
        if record.get("kind") != "pair":
            continue
        item = record.get("item")
        a = record.get("a_batch")
        b = record.get("b_batch")
        if not (
            isinstance(item, str)
            and isinstance(a, int)
            and isinstance(b, int)
            and not isinstance(a, bool)
            and not isinstance(b, bool)
        ):
            continue
        verdict = _manual_verdict(a, b, record.get("winner"))
        if verdict is None:
            continue
        key = (item, frozenset((a, b)))
        previous = index.get(key)
        if previous is None or _recorded_at(record) >= _recorded_at(previous[1]):
            index[key] = (verdict, record)
    return {key: verdict for key, (verdict, _record) in index.items()}


def _manual_low_scores(
    manual: list[dict[str, object]],
) -> dict[tuple[str, int], str]:
    """人工低分索引：(素材, 批次) → 低分维度串（跨标注者取最新记录）。"""
    lows: dict[tuple[str, int], str] = {}
    for key, record in _manual_dimension_index(manual).items():
        scores_raw = record.get("scores")
        if not isinstance(scores_raw, dict):
            continue
        scores = cast("dict[str, object]", scores_raw)
        names = [
            name
            for name, value in scores.items()
            if (
                isinstance(value, int)
                and not isinstance(value, bool)
                and value <= LOW_SCORE_THRESHOLD
            )
            or value == "有"
        ]
        if names:
            lows[key] = "、".join(sorted(set(names)))
    return lows


def _calibration_items(
    dimension_rows: list[dict[str, object]],
    config: EvalBatchConfig,
    samples: dict[str, object],
) -> set[str]:
    """校准集条目：人工全量＝judge 评过的参评条目全集；否则＝随机抽检题单。"""
    if config.human.full:
        return {
            str(row.get("item"))
            for row in dimension_rows
            if row.get("status") == "succeeded" and isinstance(row.get("item"), str)
        }
    random_raw = samples.get("random")
    if not isinstance(random_raw, list):
        return set()
    return {str(stem) for stem in cast("list[object]", random_raw)}


def _annotator_agreement(
    manual: list[dict[str, object]],
) -> dict[str, object] | None:
    """标注者间一致率：按重叠题对算 exact agreement（维度分／对比判定）。

    每键取最近一条（同一标注者改分只算新值）；只统计至少两名标注者都打过的
    题对。维度分比重叠维度的取值是否完全一致；对比判定先解析成批次号再比。
    只有一个标注者、或没有任何重叠时不出这个读数。

    Args:
        manual: 全部人工打分记录（追加序）。

    Returns:
        含 annotators 与 dimension／pairwise 两个读数（各自 n 与按条目 CI）；
        不可算时返回 None。
    """
    latest: dict[tuple[object, ...], dict[str, object]] = {}
    annotators: set[str] = set()
    for record in manual:
        annotator = record.get("annotator")
        if isinstance(annotator, str):
            annotators.add(annotator)
        key = manual_score_key(record)
        previous = latest.get(key)
        if previous is None or _recorded_at(record) >= _recorded_at(previous):
            latest[key] = record
    if len(annotators) < 2:
        return None
    dimension_groups: dict[str, list[bool]] = {}
    dimension_scores: dict[tuple[str, int], dict[str, dict[str, object]]] = {}
    pair_groups: dict[str, list[bool]] = {}
    pair_verdicts: dict[tuple[str, frozenset[int]], dict[str, str]] = {}
    for record in latest.values():
        kind = record.get("kind")
        item = record.get("item")
        annotator = record.get("annotator")
        if not (isinstance(item, str) and isinstance(annotator, str)):
            continue
        if kind == "dimension":
            batch = record.get("batch")
            scores_raw = record.get("scores")
            if (
                isinstance(batch, int)
                and not isinstance(batch, bool)
                and isinstance(scores_raw, dict)
            ):
                dimension_scores.setdefault((item, batch), {})[annotator] = cast(
                    "dict[str, object]", scores_raw
                )
        elif kind == "pair":
            a = record.get("a_batch")
            b = record.get("b_batch")
            if not (
                isinstance(a, int)
                and isinstance(b, int)
                and not isinstance(a, bool)
                and not isinstance(b, bool)
            ):
                continue
            verdict = _manual_verdict(a, b, record.get("winner"))
            if verdict is None:
                continue
            pair_verdicts.setdefault((item, frozenset((a, b))), {})[annotator] = verdict
    for (item, _batch), by_annotator in dimension_scores.items():
        if len(by_annotator) < 2:
            continue
        common: set[str] = set(next(iter(by_annotator.values())))
        for scores in by_annotator.values():
            common &= set(scores)
        if not common:
            continue
        ordered_names = sorted(common)
        signatures = {
            tuple(scores[name] for name in ordered_names)
            for scores in by_annotator.values()
        }
        dimension_groups.setdefault(item, []).append(len(signatures) == 1)
    for (item, _pair), verdicts in pair_verdicts.items():
        if len(verdicts) < 2:
            continue
        pair_groups.setdefault(item, []).append(len(set(verdicts.values())) == 1)
    readings: dict[str, object] = {}
    if dimension_groups:
        reading = _cluster_readout(
            dimension_groups, _metric_rng("annotator_agreement.dimension")
        )
        if reading is not None:
            readings["dimension"] = reading
    if pair_groups:
        reading = _cluster_readout(
            pair_groups, _metric_rng("annotator_agreement.pairwise")
        )
        if reading is not None:
            readings["pairwise"] = reading
    if not readings:
        return None
    return {"annotators": sorted(annotators), **readings}


def _dual_order_agreement_flags(
    pair_rows: list[dict[str, object]],
) -> dict[str, list[bool]]:
    """双序一致标记（按素材聚簇）：同一 (素材, 对, 裁判) 两判是否指向同一批次。"""
    grouped: dict[tuple[object, ...], list[str]] = {}
    for row in pair_rows:
        if row.get("status") != "succeeded":
            continue
        a = row.get("a_batch")
        b = row.get("b_batch")
        if not (isinstance(a, int) and isinstance(b, int)):
            continue
        verdict = _resolve_winner(row)
        if verdict is None:
            continue
        key = (row.get("item"), frozenset((a, b)), row.get("judge"))
        grouped.setdefault(key, []).append(verdict)
    flags: dict[str, list[bool]] = {}
    for (item, _pair, _judge), verdicts in grouped.items():
        if len(verdicts) >= 2:
            flags.setdefault(str(item), []).append(
                all(verdict == verdicts[0] for verdict in verdicts[1:])
            )
    return flags


def _trust_layer(
    dimension_rows: list[dict[str, object]],
    pair_rows: list[dict[str, object]],
    config: EvalBatchConfig,
    samples: dict[str, object],
    manual: list[dict[str, object]],
) -> dict[str, object]:
    """③ 裁判可信度层：只列本次实际有的证据（没开的连行都不出）。"""
    layer: dict[str, object] = {"landis_koch_bands": LANDIS_KOCH_BANDS}
    calibration_items = _calibration_items(dimension_rows, config, samples)
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
            and item in calibration_items
            and (item, batch) in calibration
        ):
            judge_rows.setdefault(str(row.get("judge")), []).append(
                (item, batch, cast("dict[str, object]", scores))
            )
    per_judge: dict[str, dict[str, object]] = {}
    for judge_id in config.judges:
        kappa_pairs: dict[str, dict[str, list[tuple[object, object]]]] = {
            dim.name: {} for dim in config.dimensions if dim.kind == KIND_SCORE5
        }
        confusion: dict[str, dict[str, int]] = {}
        confusion_groups: dict[str, dict[str, dict[str, list[bool]]]] = {}
        for item, batch, judge_scores in judge_rows.get(judge_id, []):
            manual_scores = calibration[(item, batch)].get("scores")
            if not isinstance(manual_scores, dict):
                continue
            manual_map = cast("dict[str, object]", manual_scores)
            for dim in config.dimensions:
                judge_value = judge_scores.get(dim.name)
                manual_value = manual_map.get(dim.name)
                if judge_value is None or manual_value is None:
                    continue
                if dim.kind == KIND_SCORE5:
                    kappa_pairs.setdefault(dim.name, {}).setdefault(item, []).append(
                        (judge_value, manual_value)
                    )
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
                    groups = confusion_groups.setdefault(
                        dim.name,
                        {
                            "抓中率": {},
                            "漏抓率": {},
                            "报警查准": {},
                            "误报率": {},
                        },
                    )
                    if truth:
                        groups["抓中率"].setdefault(item, []).append(flagged)
                        groups["漏抓率"].setdefault(item, []).append(not flagged)
                    else:
                        groups["误报率"].setdefault(item, []).append(flagged)
                    if flagged:
                        groups["报警查准"].setdefault(item, []).append(truth)
        kappas: list[dict[str, object]] = []
        for name, pairs_by_item in kappa_pairs.items():
            left = [left for pairs in pairs_by_item.values() for left, _ in pairs]
            right = [right for pairs in pairs_by_item.values() for _, right in pairs]
            kappa = _cohen_kappa(left, right)
            kappas.append(
                {
                    "dimension": name,
                    "kappa": round(kappa, 4) if kappa is not None else None,
                    "ci": _kappa_bootstrap_ci(
                        pairs_by_item, _metric_rng(f"kappa.{judge_id}.{name}")
                    ),
                    "n": len(left),
                }
            )
        confusions: list[dict[str, object]] = []
        for dim in config.dimensions:
            if dim.kind != KIND_BINARY or dim.name not in confusion:
                continue
            counts = confusion[dim.name]
            groups = confusion_groups[dim.name]
            prefix = f"confusion.{judge_id}.{dim.name}"
            confusions.append(
                {
                    "dimension": dim.name,
                    "counts": counts,
                    "抓中率": _cluster_readout(
                        groups["抓中率"], _metric_rng(f"{prefix}.hit")
                    ),
                    "漏抓率": _cluster_readout(
                        groups["漏抓率"], _metric_rng(f"{prefix}.miss")
                    ),
                    "报警查准": _cluster_readout(
                        groups["报警查准"], _metric_rng(f"{prefix}.precision")
                    ),
                    "误报率": _cluster_readout(
                        groups["误报率"], _metric_rng(f"{prefix}.false_alarm")
                    ),
                }
            )
        per_judge[judge_id] = {"kappa": kappas, "confusion": confusions}
    if any(judge_rows.get(judge_id) for judge_id in config.judges):
        layer["judges"] = per_judge
    # 双序一致率（开了双序才有）：两判指向同一批次的比例（不比 A/B 位置标签）。
    if (
        config.pairwise
        and config.pairwise_settings is not None
        and config.pairwise_settings.dual_order != "none"
    ):
        agreement = _cluster_readout(
            _dual_order_agreement_flags(pair_rows),
            _metric_rng("dual_order_agreement"),
        )
        if agreement is not None:
            layer["dual_order_agreement"] = agreement
    # 对比人工一致率（人工 pair 记录 vs 同题 judge 判定，逐判解析成批次号再比）。
    if config.human.pairwise_manual and pair_rows:
        manual_pairs = _manual_pair_index(manual)
        agree_groups: dict[str, list[bool]] = {}
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
            judge_verdict = _resolve_winner(row)
            if judge_verdict is None:
                continue
            agree_groups.setdefault(item, []).append(judge_verdict == manual_verdict)
        agreement = _cluster_readout(agree_groups, _metric_rng("pairwise_agreement"))
        if agreement is not None:
            layer["pairwise_agreement"] = agreement
    agreement = _annotator_agreement(manual)
    if agreement is not None:
        layer["annotator_agreement"] = agreement
    return layer


def _badcase_layer(
    dimension_rows: list[dict[str, object]],
    samples: dict[str, object],
    manual: list[dict[str, object]],
) -> dict[str, object] | None:
    """④ badcase 层：judge 幻觉条目＋人工低分条目＋定向筛查查准率与清单。

    查准率＝定向题单里「人也认为有问题」的比例（人工低分 ≤2 或幻觉判「有」）；
    还没打人工分的定向条目不计入（分母＝已打的那些）。题单只到素材主干粒度，
    所以按保守口径：该素材**所有已打分批次都低**才算命中——避免把 s2 的低分
    算到 s1 头上。人工低分表按键 (素材·批次) 落，不跨批次串用。
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
    low_scores = _manual_low_scores(manual)
    dimension_index = _manual_dimension_index(manual)
    layer: dict[str, object] = {
        "judge_hallucination": hallucination,
        "manual_low_scores": {
            f"{item}·s{batch}": text for (item, batch), text in low_scores.items()
        },
    }
    targeted = samples.get("targeted")
    if isinstance(targeted, dict):
        items = cast("dict[str, object]", targeted).get("items")
        if isinstance(items, list):
            stems = [str(stem) for stem in cast("list[object]", items)]
            scored_batches: dict[str, set[int]] = {}
            for item, batch in dimension_index:
                scored_batches.setdefault(item, set()).add(batch)
            flags: list[bool] = []
            for stem in stems:
                batches = scored_batches.get(stem)
                if not batches:
                    continue
                low_batches = {batch for (item, batch) in low_scores if item == stem}
                flags.append(batches <= low_batches)
            layer["targeted"] = {
                "items": stems,
                "precision": _readout(flags, _metric_rng("badcase.targeted_precision")),
            }
    return layer


def _counter(counters: object, key: str) -> int | None:
    """从运行计数里取一个整数字段；形状不对返回 None。"""
    if not isinstance(counters, dict):
        return None
    value = cast("dict[str, object]", counters).get(key)
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _reproducibility_layer(
    config: EvalBatchConfig,
    run_record: dict[str, object],
    manual: list[dict[str, object]],
) -> dict[str, object]:
    """⑤ 可复现层：来源与许可、批次／裁判快照、人工校准数据、工具版本、对数与调用数。

    对数按「对」计、调用按实际发起计，两者分列（``calls``＝实际调用数
    ``attempted``，``planned_calls``＝计划数）。人工校准数据与可信度层／badcase
    层用同一份「生成报告时有效」的快照——三层读数必须由同一批人工分算出来，
    否则报告自证不一致。
    """
    pairs_stat = run_record.get("pairs")
    stat = cast("dict[str, object]", pairs_stat) if isinstance(pairs_stat, dict) else {}
    pair_count = stat.get("pairs", 0)
    dual_pairs = stat.get("dual_pairs", 0)
    return {
        "dataset_source": config.dataset_source,
        "dataset_license": config.dataset_license,
        "config": run_record.get("config"),
        "judges": run_record.get("judges"),
        "candidates": run_record.get("candidates"),
        "manual_scores": manual,
        "dsf_version": run_record.get("dsf_version"),
        "pairs": pair_count if isinstance(pair_count, int) else 0,
        "dual_pairs": dual_pairs if isinstance(dual_pairs, int) else 0,
        "calls": _counter(run_record.get("counters"), "attempted"),
        "planned_calls": _counter(run_record.get("counters"), "planned"),
    }


def build_report(workdir: Path, seq: int, run_id: str) -> dict[str, object]:
    """从一次运行的落盘产物聚合五层报告并写快照（返回完整报告字典）。

    Raises:
        FileNotFoundError: 运行目录或运行记录不存在。
        ValueError: 运行标识不合法／越界、或运行记录不属于该打分批次。
        EvalReportCorruptedError: 运行记录、流水或题单损坏（读不了／形状不对）。
    """
    store = EvalStore(workdir)
    run_dir = _safe_child(store.runs_dir, run_id, kind="运行标识")
    record_path = run_dir / "run.json"
    if not record_path.is_file():
        raise FileNotFoundError(f"运行 {run_id} 不存在——请检查运行标识。")
    record = _read_json_object(record_path)
    if record.get("batch") != f"e{seq}":
        raise ValueError(f"运行 {run_id} 不属于打分批次 e{seq}。")
    try:
        config = EvalBatchConfig.from_json(record.get("config"))
    except EvalConfigCorruptedError as exc:
        raise _report_corrupted(record_path, "内嵌配置形状不对") from exc
    dimension_rows = _read_jsonl(run_dir / "scores.jsonl")
    pair_rows = _read_jsonl(run_dir / "pairs.jsonl")
    samples: dict[str, object] = {}
    samples_path = run_dir / "samples.json"
    if samples_path.is_file():
        samples = _read_json_object(samples_path)
    # 人工分只读一次：可信度、badcase、可复现三层必须消费同一份生成时快照。
    manual = _read_latest_manual(workdir)
    report: dict[str, object] = {
        "report_id": run_id,
        "batch": f"e{seq}",
        "run_id": run_id,
        "generated_at": now_iso(),
        "status": record.get("status"),
        "counters": record.get("counters"),
        "layers": {
            "ranking": _ranking_layer(pair_rows, config),
            "dimensions": _dimension_layer(dimension_rows, config),
            "trust": _trust_layer(dimension_rows, pair_rows, config, samples, manual),
            "badcase": _badcase_layer(dimension_rows, samples, manual),
            "reproducibility": _reproducibility_layer(config, record, manual),
        },
    }
    atomic_write_text(
        store.reports_dir / f"{run_id}.json",
        json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False),
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
        ValueError: 报告标识不合法／越界、或报告不属于该打分批次。
        EvalReportCorruptedError: 快照损坏（读不了／不是 JSON／根不是对象）。
    """
    store = EvalStore(workdir)
    path = _safe_child(store.reports_dir, report_id, suffix=".json", kind="报告标识")
    if not path.is_file():
        raise FileNotFoundError(f"报告 {report_id} 不存在。")
    record = _read_json_object(path)
    if record.get("batch") != f"e{seq}":
        raise ValueError(f"报告 {report_id} 不属于打分批次 e{seq}。")
    return record
