/**
 * 导航侧栏（壳层件）：可折叠侧栏——主导航、设置模式导航与全局操作脚注。
 * 桌面常驻与窄屏抽屉共用同一形态（App.tsx 两处实例化）；外壳状态（页面 / 折叠 /
 * 设置节 / 主题）是两实例必须共享的壳级状态，故由 App 持有、经 props 下传。
 */
import type { LucideIcon } from "lucide-react";
import {
  ActivityIcon,
  ArrowLeftIcon,
  FileTextIcon,
  FolderInputIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SettingsIcon,
  TagsIcon,
} from "lucide-react";
import type { Dispatch, ReactElement, SetStateAction } from "react";
import { ShutdownButton } from "../components/shutdown-button";
import { ThemeToggle } from "../components/theme-toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import type { ThemeMode } from "../hooks/use-theme";
import type { SettingsSection, ShellPage } from "../lib/ui-storage";
import { cn } from "../lib/utils";
import logo from "../logo-speed-d.png";
import { ServiceDot } from "./service-dot";

interface NavItem {
  key: ShellPage;
  label: string;
  icon: LucideIcon;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: readonly NavGroup[] = [
  {
    title: "工作区",
    items: [{ key: "prompts", label: "策略", icon: FileTextIcon }],
  },
  { title: "流水线", items: [{ key: "labeling", label: "打标", icon: TagsIcon }] },
];

/** 产品版本号（侧栏脚注）；与 package.json / 后端 app version 同步维护。 */
const APP_VERSION = "v0.1.0";

interface SidebarProps {
  page: ShellPage;
  workPage: ShellPage;
  collapsed: boolean;
  navigationOpen: boolean;
  settingsSection: SettingsSection;
  mode: ThemeMode;
  setPage: Dispatch<SetStateAction<ShellPage>>;
  setCollapsed: Dispatch<SetStateAction<boolean>>;
  setNavigationOpen: Dispatch<SetStateAction<boolean>>;
  setSettingsSection: Dispatch<SetStateAction<SettingsSection>>;
  setMode: (mode: ThemeMode) => void;
  openSettings: () => void;
}

/** 可折叠侧栏：品牌区、导航区（工作台分组 / 设置节）与全局操作脚注。 */
export function Sidebar({
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
}: SidebarProps): ReactElement {
  return (
    <aside
      data-testid="sidebar"
      className={cn(
        "flex h-full shrink-0 flex-col bg-n-75 text-text-1 transition-[width] duration-150",
        collapsed && !navigationOpen ? "w-16" : "w-62.5",
      )}
    >
      {page !== "settings" && (
        <div className="flex items-center gap-3 px-4 pt-4 pb-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() =>
                  navigationOpen
                    ? setNavigationOpen(false)
                    : setCollapsed((value) => !value)
                }
                className="group flex size-8 shrink-0 items-center justify-center rounded-md bg-black hover:bg-nav-hover"
                aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
              >
                <img
                  src={logo}
                  alt=""
                  className="size-[27px] object-contain group-hover:hidden"
                />
                {collapsed ? (
                  <PanelLeftOpenIcon className="hidden size-4 group-hover:block" />
                ) : (
                  <PanelLeftCloseIcon className="hidden size-4 group-hover:block" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>{collapsed ? "展开侧栏" : "收起侧栏"}</TooltipContent>
          </Tooltip>
          {!collapsed && (
            <span className="min-w-0">
              <span className="block truncate font-medium">Dataset Factory</span>
              <span className="block truncate text-t-sm text-text-3">
                打标流水线工具
              </span>
            </span>
          )}
        </div>
      )}

      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-1">
        {page === "settings" ? (
          <>
            <button
              type="button"
              aria-label="返回工作区"
              onClick={() => {
                setPage(workPage);
                setNavigationOpen(false);
              }}
              className="mt-2 flex h-(--h-md) w-full items-center gap-3 rounded-md px-3 text-text-3 hover:bg-nav-hover"
            >
              <ArrowLeftIcon className="size-4 shrink-0" />
              {!collapsed && "返回工作区"}
            </button>
            {!collapsed && (
              <p className="px-2 pt-4 pb-1 text-t-sm font-medium text-text-3">设置</p>
            )}
            {(
              [
                { key: "endpoints", label: "端点配置", icon: SettingsIcon },
                { key: "skills", label: "技能", icon: FolderInputIcon },
                { key: "service", label: "服务运行", icon: ActivityIcon },
              ] as const
            ).map((item) => (
              <button
                key={item.key}
                type="button"
                aria-label={item.label}
                aria-current={settingsSection === item.key ? "page" : undefined}
                onClick={() => {
                  setSettingsSection(item.key);
                  setNavigationOpen(false);
                }}
                className={cn(
                  "flex h-(--h-md) w-full items-center gap-3 rounded-md px-3 text-text-3 hover:bg-nav-hover",
                  collapsed && "justify-center px-0",
                  settingsSection === item.key &&
                    "bg-nav-active font-medium text-text-1",
                )}
              >
                <item.icon className="size-4 shrink-0" />
                {!collapsed && item.label}
              </button>
            ))}
          </>
        ) : (
          NAV_GROUPS.map((group) => (
            <div key={group.title}>
              {!collapsed && (
                <p className="px-2 pt-4 pb-1 text-t-sm font-medium text-text-3">
                  {group.title}
                </p>
              )}
              {collapsed && <div className="mx-1 my-3 h-px bg-border" />}
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = page === item.key;
                  return (
                    <li key={item.key}>
                      <button
                        type="button"
                        aria-label={item.label}
                        aria-current={active ? "page" : undefined}
                        onClick={() => {
                          setPage(item.key);
                          setNavigationOpen(false);
                        }}
                        className={cn(
                          "flex h-(--h-md) w-full items-center gap-3 rounded-md px-3 transition-colors",
                          collapsed && "justify-center px-0",
                          active
                            ? "bg-nav-active font-medium text-text-1"
                            : "text-text-3 hover:bg-nav-hover hover:text-text-1",
                        )}
                      >
                        <item.icon className="size-4 shrink-0" />
                        {!collapsed && <span className="truncate">{item.label}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </nav>

      <div
        className={cn(
          "flex items-center gap-2 border-t border-border p-3 text-t-xs text-text-4",
          collapsed ? "flex-col" : "px-4",
        )}
      >
        <ShutdownButton sidebar />
        <ThemeToggle sidebar mode={mode} onModeChange={setMode} />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="设置"
              aria-current={page === "settings" ? "page" : undefined}
              onClick={openSettings}
              className="flex size-(--h-md) shrink-0 items-center justify-center rounded-md text-text-3 hover:bg-nav-hover hover:text-text-1"
            >
              <SettingsIcon className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>设置</TooltipContent>
        </Tooltip>
        {!collapsed && (
          <span className="ml-auto flex items-center gap-1.5">
            <ServiceDot />
            <span className="tabular-nums">{APP_VERSION}</span>
          </span>
        )}
      </div>
    </aside>
  );
}
