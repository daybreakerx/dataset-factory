/**
 * 页面切换与保活视口（壳层件）：三页 Activity 保活 + 首访懒挂载。
 * 保活逻辑（visited）只被本块的 Activity 渲染消费、随块内聚，页面入口经 props
 * 回调与外壳解耦。
 */
import type { ReactElement } from "react";
import { Activity, lazy, Suspense, useEffect, useState } from "react";
import type { SettingsSection, ShellPage } from "../lib/ui-storage";
import { PromptWorkbench } from "../pages/prompt-workbench/PromptWorkbench";

/**
 * 打标页与设置容器切成分包、进页面时才载（G4「减少无谓开销」）。
 *
 * 为什么这样切：应用永远从工作台起画（`useState<PageKey>("prompts")`），工作台是首屏，
 * 保持静态导入不动；另两页的代码（含它们独用的 radix 弹层与大量业务组件）在首屏那一帧
 * 是纯浪费的下载与解析。加载在本地服务下是一帧内的事。
 */
const LabelingPage = lazy(() =>
  import("../pages/labeling/LabelingPage").then((m) => ({ default: m.LabelingPage })),
);
const SettingsPage = lazy(() =>
  import("../pages/settings/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);

interface PageViewportProps {
  page: ShellPage;
  settingsSection: SettingsSection;
  openSettings: () => void;
  onOpenWorkbench: () => void;
}

/** 页面视口：三页保活渲染（切页隐藏不卸载），页面实例的挂载边界在此决定。 */
export function PageViewport({
  page,
  settingsSection,
  openSettings,
  onOpenWorkbench,
}: PageViewportProps): ReactElement {
  // 首访挂载（visited）：没进过的页不渲染 Activity——首屏零额外成本；进过的页实例
  // 隐藏常驻（切页即隐藏不卸载，状态、DOM、滚动位置全保留）。初始集合含恢复出的
  // 起始页，重启直达「上次停留的页面」时它就是可见页。
  const [visited, setVisited] = useState<ReadonlySet<ShellPage>>(() => new Set([page]));
  useEffect(() => {
    setVisited((previous) => {
      if (previous.has(page)) return previous;
      const next = new Set(previous);
      next.add(page);
      return next;
    });
  }, [page]);

  return (
    <>
      {/* 三页 Activity 保活：切页 = 隐藏不卸载，状态、DOM、滚动位置
          全保留；Effect 隐藏自动卸载、切回重建，「挂载即取数」的刷新节奏与
          卸载重挂时代一致。首访才挂载：没进过的页不占首屏成本。滚动容器放
          在每页自己的根上——滚动位置属于页面而非外壳，三页互不干扰。 */}
      {visited.has("prompts") && (
        <Activity mode={page === "prompts" ? "visible" : "hidden"}>
          <Suspense fallback={null}>
            <div className="h-full overflow-y-auto" data-testid="page-prompts">
              <PromptWorkbench onNavigateToSettings={openSettings} />
            </div>
          </Suspense>
        </Activity>
      )}
      {visited.has("settings") && (
        <Activity mode={page === "settings" ? "visible" : "hidden"}>
          <Suspense fallback={null}>
            <div className="h-full overflow-y-auto" data-testid="page-settings">
              <SettingsPage section={settingsSection} />
            </div>
          </Suspense>
        </Activity>
      )}
      {visited.has("labeling") && (
        <Activity mode={page === "labeling" ? "visible" : "hidden"}>
          <Suspense fallback={null}>
            <div className="h-full overflow-y-auto" data-testid="page-labeling">
              <LabelingPage
                onNavigateToSettings={openSettings}
                onOpenWorkbench={onOpenWorkbench}
              />
            </div>
          </Suspense>
        </Activity>
      )}
    </>
  );
}
