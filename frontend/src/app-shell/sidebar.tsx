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
import { Tip, Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
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
  /** 窄桌面断点（768–1023）信号：桌面常驻实例据此把品牌钮转为「打开抽屉」。 */
  narrowDesktop?: boolean;
  /** 品牌区是否可交互：抽屉实例传 false——品牌区降为静态图形、撤折叠职能（对齐批实例条）。 */
  brandInteractive?: boolean;
  navigationOpen: boolean;
  settingsSection: SettingsSection;
  mode: ThemeMode;
  /** 设置页两面板有未保存修改（壳层上提）：关机确认弹窗 dirty 态的警告行判据。 */
  settingsDirty?: boolean;
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
  narrowDesktop = false,
  brandInteractive = true,
  navigationOpen,
  settingsSection,
  mode,
  settingsDirty = false,
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
          {brandInteractive ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => {
                    if (navigationOpen) {
                      setNavigationOpen(false);
                      return;
                    }
                    // 窄桌面（768–1023）侧栏被断点强制收起，手动展开改走抽屉
                    //（与 <768 顶条「打开导航」钮同路）——DESIGN.md 3.5：JS 交互态归实现侧。
                    if (narrowDesktop) {
                      setNavigationOpen(true);
                      return;
                    }
                    setCollapsed((value) => !value);
                  }}
                  className={cn(
                    "group flex shrink-0 items-center justify-center rounded-md bg-black hover:bg-accent",
                    collapsed ? "size-(--h-sm)" : "size-8",
                  )}
                  aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
                >
                  <img
                    src={logo}
                    alt=""
                    className={cn(
                      "object-contain group-hover:hidden",
                      collapsed ? "size-[22px]" : "size-[27px]",
                    )}
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
          ) : (
            <span className="flex size-8 shrink-0 items-center justify-center">
              <img src={logo} alt="" className="size-[27px] object-contain" />
            </span>
          )}
          {!collapsed && (
            <span className="min-w-0">
              {/* 品牌标名／副题被侧栏宽度截断时悬停给全文（DESIGN.md 六）。 */}
              <Tip label="Dataset Factory">
                <span className="block truncate font-medium">Dataset Factory</span>
              </Tip>
              <Tip label="打标流水线工具">
                <span className="block truncate text-t-sm text-text-3">
                  打标流水线工具
                </span>
              </Tip>
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
              className="mt-2 flex h-(--h-md) w-full items-center gap-3 rounded-md px-3 text-text-3 transition-colors duration-(--dur-1) hover:bg-accent hover:text-text-1"
            >
              <ArrowLeftIcon className="size-4 shrink-0" />
              {!collapsed && "返回工作区"}
            </button>
            {!collapsed && (
              <p className="px-2 pt-4 pb-1 text-t-sm font-medium text-text-3">设置</p>
            )}
            {collapsed && <div className="mx-1 my-3 h-px bg-n-400" />}
            <ul className="space-y-1">
              {(
                [
                  { key: "endpoints", label: "端点配置", icon: SettingsIcon },
                  { key: "skills", label: "技能", icon: FolderInputIcon },
                  { key: "service", label: "运行日志", icon: ActivityIcon },
                ] as const
              ).map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    aria-label={item.label}
                    aria-current={settingsSection === item.key ? "page" : undefined}
                    onClick={() => {
                      setSettingsSection(item.key);
                      setNavigationOpen(false);
                    }}
                    className={cn(
                      "flex h-(--h-md) w-full items-center gap-3 rounded-md px-3 text-text-3 transition-colors duration-(--dur-1) hover:bg-accent hover:text-text-1",
                      collapsed && "justify-center px-0",
                      settingsSection === item.key &&
                        "bg-nav-active font-medium text-text-1",
                    )}
                  >
                    <item.icon className="size-4 shrink-0" />
                    {!collapsed && item.label}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          NAV_GROUPS.map((group) => (
            <div key={group.title}>
              {!collapsed && (
                <p className="px-2 pt-4 pb-1 text-t-sm font-medium text-text-3">
                  {group.title}
                </p>
              )}
              {collapsed && <div className="mx-1 my-3 h-px bg-n-400" />}
              <ul className="space-y-1">
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
                          "flex h-(--h-md) w-full items-center gap-3 rounded-md px-3 transition-colors duration-(--dur-1)",
                          collapsed && "justify-center px-0",
                          active
                            ? "bg-nav-active font-medium text-text-1"
                            : "text-text-3 hover:bg-accent hover:text-text-1",
                        )}
                      >
                        <item.icon className="size-4 shrink-0" />
                        {!collapsed && (
                          <Tip label={item.label}>
                            <span className="truncate">{item.label}</span>
                          </Tip>
                        )}
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
        <ShutdownButton sidebar dirty={settingsDirty} />
        <ThemeToggle sidebar mode={mode} onModeChange={setMode} />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="设置"
              aria-current={page === "settings" ? "page" : undefined}
              onClick={() => openSettings()}
              className="flex size-(--h-md) shrink-0 items-center justify-center rounded-md text-text-3 transition-colors duration-(--dur-1) hover:bg-accent hover:text-text-1"
            >
              <SettingsIcon className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>设置</TooltipContent>
        </Tooltip>
        {/* 状态点常显（折叠态也渲染、居中于纵排最下方），版本号折叠隐藏；展开态点与
            版本号靠行尾成组（间距 8px = s-2 档）。折叠态点的 Tip 转「状态 · 版本号」。 */}
        <span
          className={cn(
            "flex items-center",
            collapsed ? "justify-center" : "ml-auto gap-2",
          )}
        >
          <ServiceDot labelSuffix={collapsed ? ` · ${APP_VERSION}` : undefined} />
          {!collapsed && <span className="tabular-nums">{APP_VERSION}</span>}
        </span>
      </div>
    </aside>
  );
}
