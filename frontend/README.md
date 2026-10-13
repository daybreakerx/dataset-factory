# frontend — 前端实现

> 本文件装前端的**结构分层**与**实现侧怎么取值**：目录怎么组织、各层允许怎样的依赖、新增代码放哪（见「目录结构与分层」）；令牌接线、Tailwind 工具类映射、已知偏差（见后三节）。
> 设计判据（原则 / 刻度 / 组件 / 图标 / 文案 / 底线）由设计规范承载，本文件不复述。

## 目录结构与分层

`src/` 按**就近分层**组织（2026-09-30 裁定前端全量重构、10-02 收口）：`App.tsx` 为编排薄壳，壳层件住 `app-shell/`（导航侧栏、页面切换＋保活视口、服务状态点）；数据访问按后端路由域拆在 `api/`（`client.ts` 公共件＋各域文件，`index.ts` 聚合门面——调用方一律 `import { api }`，不深引域文件）；会话域状态住 `session/`；跨页复用件住 `components/`（`dialog-shell.tsx` 为弹窗族件）；页面专属区块、弹窗与数据 hooks 住 `pages/<页>/` 子目录（labeling／prompt-workbench／settings 各按链再分）。

**分层依赖由 `.dependency-cruiser.cjs` 机器强制**（verify 的 depcruise 步与 CI frontend job），`biome.json` 的 `noRestrictedImports` 同向双保险——下层禁引 pages、api 禁引 UI 层、壳层只引页面入口、禁循环依赖。

### 目录树（终态）

```text
src/
├── main.tsx / App.tsx            App 为编排薄壳：只持壳级状态、组装 app-shell 与三页
├── app-shell/                    应用壳层（导航、页面切换＋保活、服务状态探测）
│   ├── sidebar.tsx               导航侧栏（品牌区/主导航/设置节导航/全局操作脚注；壳级状态经 props 下传）
│   ├── page-viewport.tsx         三页 Activity 保活视口（首访懒挂载＋lazy 分包）
│   └── service-dot.tsx           服务状态点（30s 探测＋stopping 确认轮＋事件监听）
├── api/                          数据访问层（api-types.gen.ts 生成类型在 src 根，不动）
│   ├── client.ts                 公共件：request／ApiError／errorMessage／超时
│   ├── index.ts                  聚合门面：按域拆文件后重新组装 `api` 对象，调用点 `import { api }` 零改动
│   └── <域>.ts × 13              按后端路由域切分：filesystem/workdir/batches/runs/export/strategies/
│                                 tasks/sessions/label/prompts/skills/endpoints/service（+client）
├── session/                      会话域（应用级状态，壳层与页面都可消费）
│   ├── chat-session.tsx          ChatSessionProvider（对话状态、SSE 发送链、桶管理）
│   ├── use-session-restore.ts    启动恢复域（认领/镜像 boot effect＋applySnapshot）
│   └── types.ts                  ChatMessage/PendingMedia 等会话域消息形状
├── components/                   跨页复用件
│   ├── ui/                       shadcn 原子件（button/dialog/select/toast…，不改分层）
│   ├── dialog-shell.tsx          弹窗族件（DialogContent 的纯 props 预设层，见下文）
│   └── …                         DirectoryPicker／shutdown-button／theme-toggle／media-lightbox／form-error
├── hooks/                        全站通用 hooks（use-theme／use-persisted-state）
├── lib/                          与 React 无关的纯逻辑（utils/format/feedback/toast/ui-storage）
└── pages/
    ├── labeling/                 打标页（LabelingPage 编排薄壳＋五个子域目录）
    │   ├── workdir/              工作目录链：WorkdirSettings＋六弹窗＋use-workdir-data＋三区块件
    │   ├── batching/             跑批链：BatchSelector/NewBatchForm/BatchConfiguration/两弹窗
    │   │                         ＋use-batch-form-lists＋两表单段
    │   ├── runs/                 运行链：RunControl/RunOverview/BatchOverview/ExportPanel/CaptionPreview
    │   │                         ＋四个观测 hooks＋live-output/compare-picker＋items-state/import-report 纯逻辑
    │   ├── materials/            素材域：material-row/materials-panel/material-detail
    │   └── hooks/                页面级 hooks（use-workdir-batches／use-batch-run-state，跨子域共享才进这里）
    ├── prompt-workbench/         策略页（PromptWorkbench 编排薄壳）
    │   ├── strategy/             StrategyToolbar＋strategy-menu（下拉弹层区块）＋EndpointSwitcher＋use-strategies
    │   ├── editor/               EditorColumn（编辑列）＋InputArea/BodyEditor＋use-workbench-lists
    │   └── chat/                 ChatColumn（对话列）＋MessageList（会话域状态在 src/session/，不在此）
    └── settings/                 设置页（SettingsPage 薄壳）
        ├── endpoints/            EndpointConfigPanel＋config-list/config-form/test-connection/
        │                         adv-params-section/delete-dialog＋use-endpoint-configs
        ├── skills/               SkillsPanel＋skill-list/skill-detail/import-dialog/delete-dialog
        │                         ＋use-skills＋skill-drop
        └── service/              ServicePanel（85 行自洽，无需再拆）
```

配套：`*.test.*` 与组件同目录（colocated）；Storybook stories 同目录（`.storybook/` 配置在 frontend 根）；`tokens.css` 与 `src/` 并列（令牌唯一源，见下文「令牌接线」）。

### 三条共识规则

**1. 就近**：一个页面专属的区块、弹窗、hooks 住在该页的子目录里；被两个以上页面消费才上提 `components/`。数据 hooks 与它唯一的消费区块同目录；跨区块共享的页级 hooks 进 `pages/<页>/hooks/`。不设「全站区块抽屉」——本项目区块几乎全单页专属，上提是例外而非常态。

**2. 层向**：依赖只许自上而下——`pages → (components/hooks/lib/api/session) → api`；`api` 层不碰任何 UI 层；壳层（App.tsx 与 app-shell/）只许 import 三个页面入口文件与下层公共件，禁引页面目录内部件；pages 三页互不引用；全仓禁循环依赖。机器契约见「依赖契约」。

**3. 查询收拢、命令留位**：组件内的 API 调用分两类——**查询类**（列表/详情取数、轮询、SSE 观测）收进数据 hooks，随挂载/轮询生命周期管理；**命令类**（创建/保存/删除/发车等用户动作）留在调用点原地，不造 `useStartRun()` 式无意义包装；命令后需要刷新列表时调 hook 暴露的 reload/fetchList。hooks 化不改请求时序（依赖数组、清理函数、竞态守卫逐字随迁）。

### 数据层与 hooks 约定

- **api 层只做取数封装**：按后端路由域一域一文件（`api/strategies.ts` 等），统一走 `client.ts` 的 request；生成类型 `api-types.gen.ts` 由 `npm run gen:api` 产出、不手改。调用方一律 `import { api } from "../../api"`（聚合门面），不深引域文件。
- **数据 hooks 三种落点**：唯一消费区块 → 区块同目录（如 `endpoints/use-endpoint-configs.ts`）；跨区块共享 → `pages/<页>/hooks/`（如 labeling 的 `use-workdir-batches.ts`）；应用级 → `src/session/`（会话恢复）。全站通用 → `src/hooks/`。
- **观测域整体收拢**：轮询、SSE 订阅、重连退避这类「带生命周期的观测」整体进 hook（如 runs 的 `use-run-watch`、`use-latest-run`），命令与确认弹窗留组件；hook 暴露状态与 setter 供命令侧协同。
- **测试不动原则**：页面级组件测试按角色/文本断言，对拆块天然免疫；测试文件随所属模块同目录，mock 用部分 mock 惯例（见既有测试）。

### 弹窗族件（DialogShell）

- `components/dialog-shell.tsx` 是 `DialogContent` 的**纯 props 预设层**：标准头行（title/description）＋页脚三态（cancel/confirm 动作对、note 备注槽＋footerExtra、自由 footer）＋className 透传。**零新增 DOM**——族件不引入包装元素，这是渲染等价可验证的前提。
- **表单/确认语义的弹窗走族件**（判据＝成立「取消/确认」动作对；飞行守卫是 props 选项不是分类依据）；非表单形态（工具钮型）不硬套，现役豁免＝App 窄屏导航抽屉、RunOverview 运行日志、SnapshotDialog 快照查看器。
- 视觉档位（宽度、页脚分隔线条件等）以设计规范为准；改族件一处、全部实例生效。

### Storybook 约定

- stories 与组件**同目录**（`*.stories.tsx`），页面 stories 对应定稿页面稿。
- 数据面＝`.storybook/preview.tsx` 的 **fetch stub 装饰器**：桩表键＝方法＋pathname（剥 query），未登记的 `/api/*` 一律 404（缺桩看得见）；页面挂载即取数，story 必须配桩表，否则全落错误态。
- 异步取数页面的 play function 先等数据落成（`findBy*`）再交互。

### 依赖契约（机器强制）

`workspace/frontend/.dependency-cruiser.cjs` 五条规则（verify 的 `depcruise` 步与 CI frontend job 强制）：

| 规则 | 内容 |
| --- | --- |
| shell-no-deep-page-imports | App.tsx 与 app-shell/ 只许引三个页面入口文件（LabelingPage/PromptWorkbench/SettingsPage）＋壳层自身件＋下层公共件；新增页面入口须同步加白名单 |
| pages-no-cross-page-imports ×3 | pages 三页两两互斥（同页内部互引不受限） |
| lower-layers-no-pages-imports | components/lib/hooks/api/session 禁引 pages |
| api-no-ui-layer-imports | api 层禁引 components/pages/hooks/session |
| no-circular | 禁循环依赖 |

口径：type-only import **不豁免**（批17 收紧——越层的类型引用同样是分层违规）；`*.test.*` 测试文件豁免（colocated 测试天然引用页面内部件）。Biome 侧 `noRestrictedImports` 以 overrides 对下层五目录、api、壳层做同向双保险（规则细节以 `.dependency-cruiser.cjs` 为权威）。每条规则都做过「故意造违规」探针自证——「0 违规」必须建立在「工具真的能抓」之上。

## 令牌接线

`tokens.css`（与 `src/` 并列、不进 `src`）是**唯一取值源**；`src/globals.css` 以 `@import "../tokens.css"` 接回，Tailwind 侧经 `@theme` / `@theme inline` 映射成工具类。

**改令牌只改 `tokens.css` 一处**，引用它的原型稿与实现两侧视觉同时变；不要再在 `src/` 里写第二份令牌。

## Tailwind 映射表

写页面时按本表取工具类，**不写任意值**；本表没有的形态先回设计规范层讨论，不私造。

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
