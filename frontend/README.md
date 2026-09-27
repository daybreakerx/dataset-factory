# frontend — 前端实现

> 本文件只装**实现侧怎么取值**：令牌接线 ＋ Tailwind 工具类映射 ＋ 已知偏差（待清）。
> 设计规范（原则 / 刻度 / 组件 / 图标 / 文案 / 底线）在外层协作仓 `context/design/`（`ui-spec.md` 系统级、`components/` 组件级），本文件不复述判据。

## 令牌接线

`tokens.css`（与 `src/` 并列、不进 `src`）是**唯一取值源**；`src/globals.css` 以 `@import "../tokens.css"` 接回，Tailwind 侧经 `@theme` / `@theme inline` 映射成工具类。

**改令牌只改 `tokens.css` 一处**，原型稿（外层 `context/design/prototype/`）以 `<link>` 引同一份文件，两边的视觉同时变。「实现侧手抄副本＋保持一字不差」的旧机制已终结——不要再在 `src/` 里写第二份令牌。

## Tailwind 映射表

写页面时按本表取工具类，**不写任意值**；本表没有的形态先回规范层讨论（`context/design/workflow.md` 二）。

| 规范令牌 | 实现侧工具类 | 说明 |
| --- | --- | --- |
| 颜色槽位（background / card / primary…） | `bg-*` / `text-*` / `border-*`（如 `bg-background`） | shadcn 语义槽，亮暗随 `.dark` 自动翻转 |
| `--n-0` … `--n-1000` | `bg-n-*` / `text-n-*` / `border-n-*` | 中性阶 16 档，随 `.dark` 翻转 |
| 语义色三件组（ok/warn/bad/info） | `bg-*-ink` / `bg-*-bg` / `border-*-bd` / `text-*-ink` | 如 `bg-ok-ink`、`text-bad-ink`；另有 `--bad-ink-soft`（`bg-bad-ink-soft`）与 `--bad-ink-strong` |
| `--on-ink` | `text-on-ink`（画在语义实底上的字与图形） | 亮取白、暗翻深 |
| `--t-xs` … `--t-2xl` | `text-t-xs` … `text-t-2xl` | 行高已按规范绑进工具类（tight / base）；**不要再写 `text-[13px]` 类任意值** |
| 字体族 `--font-sans` / `--font-mono` | `font-sans` / `font-mono`（body 默认 font-sans） | HarmonyOS Sans / 等宽（等宽已撤出界面，仅为兼容保留） |
| 圆角 r-xs / r-sm / r-md / r-lg / r-full | `rounded-sm` / `rounded-md` / `rounded-lg` / `rounded-xl` / `rounded-full` | 阶梯已重定义，shadcn 组件随类取值 |
| 间距 s-1…s-8 + 共享档 14px | Tailwind 默认间距（`p-1`↔4px、`p-3`↔12px、`p-3.5`↔14px、`p-6`↔24px…） | 刻度天然同构；半档仅 `p-3.5`（= 14px，已登记共享档）可用，其余私造值禁用 |

## 已知偏差（待清，不新增）

- 一期页面（提示词工作台 / 设置页）内尚有约 110 处任意字号（11.5 / 12.5 / 13.5 / 16.5 / 17 / 20px）与少量半档间距，随二期前端开发**改到哪片顺带清到哪片**。
- 半档间距中的 14px（`p-3.5`）已登记为共享档、属合规；其余半档仍属偏差。
- 间距与控件高度的其余取值与规范一致，只是写法为任意值。
