"""度量棘轮的机械比对步：抑制类计数只许持平或下降。

为什么单独成步：measure_metrics.py 只计数、无阈值比对，跨会话靠人眼比对「不得新增」
必然漏。本脚本把「biome-ignore 总数 / useExhaustiveDependencies 豁免数」两项
棘轮钉进 verify 流程——计数超过基线即非 0 退出，红在人眼前、不用攒到收口复核。

用法（verify-steps.txt 里跟在 measure_metrics --json 步骤之后）：
    python scripts/metrics_ratchet.py .verify/metrics.json scripts/metrics-baseline.json

口径自证（度量脚本要能证明自己没坏）：每次跑都打印读到的两个计数值；
「当前 0 / 基线 5」这类倒挂先怀疑脚本读错文件，再信结论。
"""

from __future__ import annotations

import json
import sys

#: 纳入棘轮的指标名（必须与 measure_metrics.py 的 PATTERNS 名字逐字一致；名字漂了就 FAIL）。
WATCHED: tuple[str, ...] = (
    "前端 biome-ignore 总数",
    "前端 useExhaustiveDependencies 豁免",
)


def read_counts(path: str) -> dict[str, int]:
    """从 measure_metrics 的 --json 产物里提取棘轮计数；缺指标即退出（口径漂移大声失败）。"""
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    dup = data.get("重复与死代码计数", {})
    if not isinstance(dup, dict):
        sys.exit(
            f"FAIL：{path} 里没有「重复与死代码计数」段——产物不是 measure_metrics --json 的输出？"
        )
    counts: dict[str, int] = {}
    for name in WATCHED:
        entry = dup.get(name)
        if entry is None:
            sys.exit(
                f"FAIL：{path} 缺指标「{name}」——measure_metrics.py 的口径漂了，先核对再跑"
            )
        counts[name] = entry["数量"] if isinstance(entry, dict) else entry
    return counts


def main(argv: list[str]) -> int:
    """入口：当批 JSON 与基线 JSON 比对，只锁「不得上升」（下降是好事，不禁）。"""
    if len(argv) != 2:
        print(
            "用法：python scripts/metrics_ratchet.py <当批.json> <基线.json>",
            file=sys.stderr,
        )
        return 2
    current = read_counts(argv[0])
    baseline = read_counts(argv[1])
    print("棘轮口径自证（当前 / 基线）：")
    failed = False
    for name in WATCHED:
        cur, base = current[name], baseline[name]
        verdict = "ok" if cur <= base else "FAIL（不得上升）"
        print(f"  {name}：{cur} / {base} → {verdict}")
        if cur > base:
            failed = True
    if failed:
        print(
            "棘轮失守：抑制计数上升。停下核查——确需新增豁免须呈用户裁决，不许就地豁免。"
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
