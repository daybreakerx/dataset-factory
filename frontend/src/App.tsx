import { PanelLeftOpenIcon } from "lucide-react";
import type { Dispatch, ReactElement, SetStateAction } from "react";
import { useCallback, useRef, useState } from "react";
import { PageViewport } from "./app-shell/page-viewport";
import { Sidebar } from "./app-shell/sidebar";
import { Dialog, DialogContent, DialogTitle } from "./components/ui/dialog";
import { ToastViewport } from "./components/ui/toast";
import { Tip, TooltipProvider } from "./components/ui/tooltip";
import { UnsavedConfirmDialog } from "./components/unsaved-confirm-dialog";
import { useMediaQuery } from "./hooks/use-media-query";
import { usePersistedState } from "./hooks/use-persisted-state";
import { useTheme } from "./hooks/use-theme";
import {
  isShellPage,
  type SettingsSection,
  SHELL_PAGE_KEY,
  SHELL_SETTINGS_SECTION_KEY,
  SHELL_SIDEBAR_COLLAPSED_KEY,
  type ShellPage,
} from "./lib/ui-storage";
import type { PanelUnsavedActions } from "./lib/unsaved-actions";
import { ChatSessionProvider } from "./session/chat-session";

/** 设置节恢复守卫：localStorage 里的 JSON 不可信，畸形值回退默认节。 */
function isSettingsSection(value: unknown): value is SettingsSection {
  return value === "endpoints" || value === "skills" || value === "service";
}

/** 顶级页面：一期两项（提示词工作台 / 设置容器）；后续期页面届时挂主导航长入。 */
type PageKey = ShellPage;

/**
 * 应用外壳：持有壳级状态（上次页面 / 侧栏折叠 / 设置节 / 主题）并编排布局——
 * 导航侧栏、页面切换＋保活与服务状态探测的实体件在 app-shell/。
 * 侧栏状态经 props 下传：桌面常驻与窄屏抽屉是侧栏的两处实例，必须共享同一份状态。
 */
export function App(): ReactElement {
  const { mode, setMode } = useTheme();
  // 外壳三态跨重启持久化（页面状态保持）：上次页面 / 侧栏折叠 / 设置节——
  // 重开应用回到离开时的样子。默认 8000 端口固定，localStorage 按 origin 隔离不影响。
  const [page, setPage] = usePersistedState<PageKey>(
    SHELL_PAGE_KEY,
    "prompts",
    isShellPage,
  );
  const [collapsed, setCollapsed] = usePersistedState<boolean>(
    SHELL_SIDEBAR_COLLAPSED_KEY,
    false,
  );
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [settingsSection, setSettingsSection] = usePersistedState<SettingsSection>(
    SHELL_SETTINGS_SECTION_KEY,
    "endpoints",
    isSettingsSection,
  );
  const [workPage, setWorkPage] = useState<PageKey>("prompts");
  // 窄桌面（768–1023）断点形态：侧栏自动收起为图标条（两栏保持）——响应式顺序
  // 「缩窄先收侧栏、再变上下布局」（稿侧 §21 同口径）。
  // 合成值不落盘：进入区间即收起，离开后恢复用户自己的折叠偏好。
  const narrowDesktop = useMediaQuery("(min-width: 768px) and (max-width: 1023.98px)");

  // ---------- 设置页未保存拦截（dirty 语义改写＋切页确认弹窗，2026-10-04 裁） ----------
  // 面板 dirty 上提一跳（面板 → SettingsPage → 本层），只拦设置子侧栏切子页——
  // 主侧栏切顶级页不触发（顶层三页 Activity 保活、切走编辑不丢）；关闭服务不弹
  // 本弹窗（dirty×关机走「关机确认弹窗 dirty 态」的合并一窗）。
  const [settingsDirty, setSettingsDirty] = useState(false);
  const settingsActionsRef = useRef<PanelUnsavedActions | null>(null);
  const [unsavedOpen, setUnsavedOpen] = useState(false);
  const [unsavedError, setUnsavedError] = useState("");
  const [unsavedBusy, setUnsavedBusy] = useState(false);
  const [pendingSection, setPendingSection] = useState<SettingsSection | null>(null);

  const guardSettingsSection: Dispatch<SetStateAction<SettingsSection>> = useCallback(
    (next) => {
      const target = typeof next === "function" ? next(settingsSection) : next;
      if (target === settingsSection) return;
      if (settingsDirty) {
        setPendingSection(target);
        setUnsavedError("");
        setUnsavedOpen(true);
        return;
      }
      setSettingsSection(target);
    },
    [settingsSection, settingsDirty, setSettingsSection],
  );

  const bindSettingsActions = useCallback((actions: PanelUnsavedActions | null) => {
    settingsActionsRef.current = actions;
  }, []);

  /** 弹窗「保存修改」（primary）：保存成功 → 切子页；业务失败 → 弹窗红字保持打开；
   *  环境类 → 浮层已提示、弹窗保持打开无红字（未保存确认弹窗稿）。 */
  const confirmUnsavedSave = async (): Promise<void> => {
    if (pendingSection === null || unsavedBusy) return;
    const target = pendingSection;
    setUnsavedBusy(true);
    try {
      const result = await (settingsActionsRef.current?.save() ??
        Promise.resolve({ ok: false, error: "" }));
      if (!result.ok) {
        if (result.error !== "") setUnsavedError(result.error);
        return;
      }
      setUnsavedOpen(false);
      setUnsavedError("");
      setPendingSection(null);
      setSettingsSection(target);
    } finally {
      setUnsavedBusy(false);
    }
  };

  /** 弹窗「放弃修改」（secondary）：回退修改 → 切子页。 */
  const discardUnsaved = (): void => {
    if (pendingSection === null || unsavedBusy) return;
    const target = pendingSection;
    settingsActionsRef.current?.revert();
    setUnsavedOpen(false);
    setUnsavedError("");
    setPendingSection(null);
    setSettingsSection(target);
  };

  /** 叉号／Esc：关弹窗、留在当前子页不动作（dirty 原状保持）。 */
  const closeUnsaved = (open: boolean): void => {
    if (open) return;
    setUnsavedOpen(false);
    setUnsavedError("");
    setPendingSection(null);
  };

  function openSettings(section?: SettingsSection) {
    if (page !== "settings") setWorkPage(page);
    // 子页定向（族弹层「前往设置」钮）：带哪节落哪节，不带沿用上次。
    // 防「当 onClick 直传」被 React 塞进事件对象：非合法节值一律忽略（set 进去会出现
    // 没有任何分支命中的非法节、内容区空白——E2E 实锤过一轮）。
    if (isSettingsSection(section)) setSettingsSection(section);
    setPage("settings");
    setNavigationOpen(false);
  }

  // 窄屏顶条页签名随页变：不显示产品名（窄屏顶条 零件稿口径；设置随当前子页变）。
  const pageLabel =
    page === "settings"
      ? ({ endpoints: "端点配置", skills: "技能", service: "运行日志" } as const)[
          settingsSection
        ]
      : page === "labeling"
        ? "打标"
        : "策略";

  const sidebarProps = {
    page,
    workPage,
    collapsed,
    navigationOpen,
    settingsSection,
    mode,
    settingsDirty,
    setPage,
    setCollapsed,
    setNavigationOpen,
    setSettingsSection: guardSettingsSection,
    setMode,
    openSettings,
  };

  return (
    <TooltipProvider>
      <div className="flex h-full min-w-0 flex-col overflow-hidden md:flex-row">
        <div className="hidden h-full shrink-0 md:block">
          <Sidebar
            {...sidebarProps}
            collapsed={collapsed || narrowDesktop}
            narrowDesktop={narrowDesktop}
          />
        </div>
        <div className="flex shrink-0 items-center gap-3 bg-n-75 px-4 py-2 md:hidden">
          <button
            type="button"
            aria-label="打开导航"
            onClick={() => {
              setCollapsed(false);
              setNavigationOpen(true);
            }}
            className="flex size-(--h-md) shrink-0 items-center justify-center rounded-md text-text-3 transition-colors duration-(--dur-1) hover:bg-accent hover:text-text-1"
          >
            <PanelLeftOpenIcon className="size-(--icon-md)" />
          </button>
          {/* 窄屏顶条页签名：顶条窄、签名长时被截断——悬停给全文（DESIGN.md 六）。 */}
          <Tip label={pageLabel}>
            <span className="truncate font-medium">{pageLabel}</span>
          </Tip>
        </div>
        <Dialog open={navigationOpen} onOpenChange={setNavigationOpen}>
          <DialogContent
            aria-describedby={undefined}
            // 抽屉叉钮＝弹窗壳关闭钮的抽屉实例位（稿 侧栏展收：绝对定位上/右各 12），
            // 悬停底走 --accent 半透明墨（任意表面成立，ADR「悬停 / 高亮底改表面无关的半透明墨」）。
            closeClassName="top-3 right-3 hover:bg-accent"
            className="left-0 top-0 h-dvh w-62.5 max-w-full translate-x-0 translate-y-0 gap-0 rounded-none border-0 p-0"
          >
            <DialogTitle className="sr-only">导航</DialogTitle>
            <Sidebar {...sidebarProps} collapsed={false} brandInteractive={false} />
          </DialogContent>
        </Dialog>
        <main className="min-h-0 min-w-0 flex-1">
          {/* 对话会话域住在页面边界之外：它是跨页共享的应用级状态（流式生成不随
              页面显隐起落）。页面改用 Activity 保活、切页不再卸载后，这层上提
              依然保留——会话的生命周期本来就比任何一页长，层级与「哪页在显示」
              解耦，不依赖保活细节。 */}
          <ChatSessionProvider>
            <PageViewport
              page={page}
              settingsSection={settingsSection}
              openSettings={openSettings}
              onOpenWorkbench={() => setPage("prompts")}
              onSettingsDirtyChange={setSettingsDirty}
              onRegisterActions={bindSettingsActions}
            />
          </ChatSessionProvider>
        </main>
      </div>
      {/* 设置页未保存确认弹窗（壳级）：子侧栏切子页 dirty 时的兜底——三路行为随稿。 */}
      <UnsavedConfirmDialog
        open={unsavedOpen}
        onOpenChange={closeUnsaved}
        flight={unsavedBusy}
        error={unsavedError}
        onSave={() => void confirmUnsavedSave()}
        onDiscard={discardUnsaved}
      />
      {/* 浮层提示挂在外壳唯一一处：连接类失败在各页面投递，渲染出口只留一个。 */}
      <ToastViewport />
    </TooltipProvider>
  );
}
