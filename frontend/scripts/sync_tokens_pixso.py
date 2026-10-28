"""tokens → Pixso 变量同步：生成幂等的应用计划与校验报告。

职责与定位
----------
令牌链的最后一环。上游：`workspace/frontend/tokens.json`（唯一令牌源）经既有脚本生成
`tokens.figma.json`（本脚本的输入，已归一化为每变量 light/dark 双值）。本脚本把它转换成
Pixso 侧可直接执行的变量应用计划，并在给出 Pixso 现状 dump 时做差异校验——**二跑零写入**
的幂等性由「现状与计划一致时 diff 为空」保证。

Pixso 侧执行方式（由 agent 完成，脚本不直连 Pixso）：
1. 用 Pixso MCP `eval_script` 导出现状（见 `dump_state_snippet`），存为 state.json；
2. 运行本脚本生成 `plan.json`（每变量的 light/dark 目标值与差异标记）；
3. 对 diff 非空的变量，用 `pixso.variables.getVariableById(id).setValueForMode(modeId, rgba)`
   逐个写入（**不要用 MCP write_variables 按名更新**——对导入创建的变量它会另建重复项，
   见迁移任务线坑清单）；
4. 重导 state.json 复跑本脚本，diff 为空即收敛。

用法
----
    python sync_tokens_pixso.py --tokens tokens.figma.json [--state state.json] --out plan.json

输入约定
--------
- tokens.figma.json：`{"variables": [{"name", "type", "light": {...}, "dark": {...}}]}`，
  值形态为 `{"color": {r,g,b,a}}`（0–1 浮点）或 `{"alias": "color/n-900", "opacity"?: 0.06}`。
- state.json（可选）：`{"modeIds": {"light": "5:0", "dark": "9:7953"},
  "variables": {"color/accent": {"light": "#1718270F", "dark": "#E3E5E80F"}}}`（8 位 hex）。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

Json = dict[str, Any]

# 不建成 Pixso 变量的令牌：动效令牌自 Figma 时代即不进变量系统（由 CSS/代码消费），
# 与设计文件现状一致（103 变量 = 106 令牌 − 3 动效）。
EXCLUDE = {"motion/duration/1", "motion/duration/2", "motion/easing/default"}


def rgba01_to_hex8(value: dict[str, float]) -> str:
    """0–1 RGBA 字典转 8 位 hex（如 #2463EBFF）。"""
    parts = [value.get(k, 1.0 if k == "a" else 0.0) for k in ("r", "g", "b", "a")]
    return "#" + "".join(f"{max(0, min(255, round(p * 255))):02X}" for p in parts)


def resolve_value(
    value: Any, by_name: dict[str, Json], mode: str, seen: set[str] | None = None
) -> Any:
    """把 tokens.figma.json 的值形态解析为目标形态（色值→8 位 hex，浮点/字符串原样）。

    字面值直接转换；别名沿 `alias` 指向同名变量的**同模式**值递归解析；
    别名带 `opacity` 时解析目标色后替换 alpha。环引用报错退出。
    """
    seen = seen or set()
    if isinstance(value, (int, float, str)) or value is None:
        return value
    if isinstance(value, dict) and "alias" in value:
        target = value["alias"]
        if target in seen:
            raise SystemExit(f"别名环引用：{target}")
        seen = seen | {target}
        target_entry = by_name[target]
        raw = target_entry.get(mode)
        if raw is None:
            raw = (
                target_entry.get("light")
                if target_entry.get("light") is not None
                else target_entry.get("dark")
            )
        resolved = resolve_value(raw, by_name, mode, seen)
        opacity = value.get("opacity")
        if (
            opacity is not None
            and isinstance(resolved, str)
            and resolved.startswith("#")
        ):
            resolved = resolved[:7] + f"{round(opacity * 255):02X}"
        return resolved
    if isinstance(value, dict) and "color" in value:
        return rgba01_to_hex8(value["color"])
    if isinstance(value, list) and len(value) == 4:
        return rgba01_to_hex8(
            {"r": value[0], "g": value[1], "b": value[2], "a": value[3]}
        )
    if isinstance(value, dict) and "value" in value:
        return resolve_value(value["value"], by_name, mode, seen)
    raise SystemExit(f"无法解析的值形态：{value!r}")


def build_plan(tokens: Json, state: Json | None) -> Json:
    """生成应用计划：每变量的 light/dark 目标 hex；有 state 时标注 diff。"""
    variables = tokens["variables"]
    by_name: dict[str, Json] = {v["name"]: v for v in variables}
    plan_vars: dict[str, Any] = {}
    for v in variables:
        name = v["name"]
        if name in EXCLUDE:
            continue
        light_hex = (
            resolve_value(v["light"], by_name, "light")
            if v.get("light") is not None
            else None
        )
        dark_hex = (
            resolve_value(v["dark"], by_name, "dark")
            if v.get("dark") is not None
            else light_hex
        )
        entry: dict[str, Any] = {"light": light_hex, "dark": dark_hex}
        if state:
            cur = state.get("variables", {}).get(name)
            entry["status"] = (
                "ok"
                if cur and cur.get("light") == light_hex and cur.get("dark") == dark_hex
                else "diff"
            )
        plan_vars[name] = entry
    diffs = sorted(n for n, e in plan_vars.items() if e.get("status") == "diff")
    return {
        "modeIds": (state or {}).get(
            "modeIds", {"light": "<light modeId>", "dark": "<dark modeId>"}
        ),
        "variables": plan_vars,
        "summary": {
            "total": len(plan_vars),
            "diff": len(diffs) if state else None,
            "diffNames": diffs,
            "converged": bool(state) and not diffs,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="tokens.figma.json → Pixso 变量应用计划"
    )
    parser.add_argument("--tokens", required=True, help="tokens.figma.json 路径")
    parser.add_argument(
        "--state", help="Pixso 现状 dump（eval_script 导出的 state.json），可选"
    )
    parser.add_argument("--out", required=True, help="输出 plan.json 路径")
    args = parser.parse_args()

    tokens = json.loads(Path(args.tokens).read_text(encoding="utf-8"))
    state = (
        json.loads(Path(args.state).read_text(encoding="utf-8")) if args.state else None
    )
    plan = build_plan(tokens, state)
    Path(args.out).write_text(
        json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    summary = plan["summary"]
    status = (
        "已收敛（0 差异）"
        if summary["converged"]
        else f"待应用差异 {summary['diff']} 项"
        if state
        else "未提供 state，仅生成计划"
    )
    print(f"plan 写入 {args.out}：{summary['total']} 变量；{status}")
    if state and not summary["converged"]:
        print("差异清单：", json.dumps(summary["diffNames"], ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
