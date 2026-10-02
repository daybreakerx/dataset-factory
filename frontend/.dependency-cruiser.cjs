// 前端分层契约（dependency-cruiser）—— 前端全量重构线 批3「防线契约 v1」。
//
// 为什么有它：后端有 import-linter 的分层契约在 CI 强制，前端此前一条结构规则都没有——
// 「有没有东西在替人盯着结构」的差别（process/协作仓重构.md §4.5）。契约挡「分层被违反」，
// 挡不住「分层分得对不对」，也抓不到「复制」；分层形态的权威口径在
// process/前端重构线.md §二（终态目录树），人读规范批17 成文于 context/product/frontend-structure.md。
//
// 全局口径（规划档 批3）：
// - type-only import 一律放行（dependencyTypesNot: ["type-only"]；批17 复核是否收紧）；
// - *.test.* 测试文件豁免出契约——colocated 测试天然 import 页面内部件，
//   不豁免则「现有代码零违规」不可达（第十轮审计 J5）；
// - 每条规则都做过「故意造违规」探针自证（批3.5，git 历史 359 之后一笔可见），防「0 违规」是工具没跑起来的假绿。

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "shell-no-deep-page-imports",
      comment:
        "壳层条：App.tsx 与 app-shell/ 只许 import 页面入口文件（组件与其导出类型）、壳层自身件、下层公共件；禁 import 页面目录内非入口文件。新增页面入口须同步加入 pathNot 白名单。",
      severity: "error",
      from: {
        path: "^src/(App\\.tsx|app-shell/)",
        pathNot: ["\\.test\\.[jt]sx?$"],
      },
      to: {
        path: "^src/pages/",
        pathNot: [
          "^src/pages/labeling/LabelingPage\\.tsx$",
          "^src/pages/prompt-workbench/PromptWorkbench\\.tsx$",
          "^src/pages/settings/SettingsPage\\.tsx$",
        ],
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "pages-no-cross-page-imports--labeling",
      comment:
        "pages 同层不互引：labeling 禁 import 另两个页面的文件（同页内部互引不受限）。跨页等价于「页面目录两两互斥」，dependency-cruiser 无跨 from/to 回引机制，按三个页面各立一条等价规则。",
      severity: "error",
      from: {
        path: "^src/pages/labeling/",
        pathNot: ["\\.test\\.[jt]sx?$"],
      },
      to: {
        path: "^src/pages/(prompt-workbench|settings)/",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "pages-no-cross-page-imports--prompt-workbench",
      comment: "同上：prompt-workbench 禁 import 另两个页面的文件。",
      severity: "error",
      from: {
        path: "^src/pages/prompt-workbench/",
        pathNot: ["\\.test\\.[jt]sx?$"],
      },
      to: {
        path: "^src/pages/(labeling|settings)/",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "pages-no-cross-page-imports--settings",
      comment: "同上：settings 禁 import 另两个页面的文件。",
      severity: "error",
      from: {
        path: "^src/pages/settings/",
        pathNot: ["\\.test\\.[jt]sx?$"],
      },
      to: {
        path: "^src/pages/(labeling|prompt-workbench)/",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "lower-layers-no-pages-imports",
      comment:
        "下层禁引页面：components/lib/hooks/api/session 禁 import pages（页面可以依赖下层，下层不得反向依赖页面）。",
      severity: "error",
      from: {
        path: "^src/(components|lib|hooks|api|session)/",
        pathNot: ["\\.test\\.[jt]sx?$"],
      },
      to: {
        path: "^src/pages/",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "api-no-ui-layer-imports",
      comment: "api 层禁 import 一切 UI 层（components/pages/hooks/session）。",
      severity: "error",
      from: {
        path: "^src/api/",
        pathNot: ["\\.test\\.[jt]sx?$"],
      },
      to: {
        path: "^src/(components|pages|hooks|session)/",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "no-circular",
      comment: "禁循环依赖（批3 前实测全仓 0 环，可达）。",
      severity: "error",
      from: {
        pathNot: ["\\.test\\.[jt]sx?$"],
      },
      to: {
        circular: true,
      },
    },
  ],
  options: {
    /* 生成物与外部包不深追：node_modules 内部依赖不在契约范围内 */
    doNotFollow: { path: "node_modules" },
    /* 动态 import（App.tsx 的 lazy 页面加载）也要进图，壳层条管得到它 */
    tsPreCompilationDeps: true,
    /* TS 项目解析（无路径别名，仅取其扩展名解析行为） */
    tsConfig: { fileName: "tsconfig.json" },
  },
};
