import { PanelLeftOpenIcon } from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";
import { PageViewport } from "./app-shell/page-viewport";
import { Sidebar } from "./app-shell/sidebar";
import { Dialog, DialogContent, DialogTitle } from "./components/ui/dialog";
import { ToastViewport } from "./components/ui/toast";
import { TooltipProvider } from "./components/ui/tooltip";
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

  function openSettings() {
    if (page !== "settings") setWorkPage(page);
    setPage("settings");
    setNavigationOpen(false);
  }

  const sidebarProps = {
    page,
    workPage,
    collapsed,
    navigationOpen,
    settingsSection,
    mode,
    setPage,
    setCollapsed,
    setNavigationOpen,
    setSettingsSection,
    setMode,
    openSettings,
  };

  return (
    <TooltipProvider>
      <div className="flex h-full min-w-0 flex-col overflow-hidden md:flex-row">
        <div className="hidden h-full shrink-0 md:block">
          <Sidebar {...sidebarProps} />
        </div>
        <div className="flex shrink-0 items-center gap-3 bg-n-75 px-4 py-2 md:hidden">
          <button
            type="button"
            aria-label="打开导航"
            onClick={() => {
              setCollapsed(false);
              setNavigationOpen(true);
            }}
            className="flex size-(--h-md) shrink-0 items-center justify-center rounded-md text-text-3 hover:bg-nav-hover"
          >
            <PanelLeftOpenIcon className="size-4" />
          </button>
          <span className="truncate font-medium">Dataset Factory</span>
        </div>
        <Dialog open={navigationOpen} onOpenChange={setNavigationOpen}>
          <DialogContent
            aria-describedby={undefined}
            className="left-0 top-0 h-dvh w-62.5 max-w-full translate-x-0 translate-y-0 gap-0 rounded-none border-0 p-0"
          >
            <DialogTitle className="sr-only">导航</DialogTitle>
            <Sidebar {...sidebarProps} />
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
            />
          </ChatSessionProvider>
        </main>
      </div>
      {/* 浮层提示挂在外壳唯一一处：连接类失败在各页面投递，渲染出口只留一个。 */}
      <ToastViewport />
    </TooltipProvider>
  );
}
