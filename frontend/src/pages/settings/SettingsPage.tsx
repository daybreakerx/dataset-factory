/**
 * 设置容器（design「设置容器与技能预览」）：左二级导航（连接 / 能力 / 服务）+ 右内容区。
 * 子页切换即导航切换；未来新设置项（生成参数等）加导航项即可，不再新增主导航。
 * 子面板按 feature 目录拆分：endpoints / skills / service 各一个面板文件。
 */
import type { ReactElement } from "react";
import { TooltipProvider } from "../../components/ui/tooltip";
import type { SettingsSection } from "../../lib/ui-storage";
import type { PanelUnsavedActions } from "../../lib/unsaved-actions";
import { cn } from "../../lib/utils";
import { EndpointConfigPanel } from "./endpoints/EndpointConfigPanel";
import { ServicePanel } from "./service/ServicePanel";
import { SkillsPanel } from "./skills/SkillsPanel";

export function SettingsPage({
  section = "endpoints",
  onSettingsDirtyChange,
  onRegisterActions,
}: {
  section?: SettingsSection;
  /** 面板 dirty 上报（设置子侧栏切子页的离开拦截；两面板只有一席在场）。 */
  onSettingsDirtyChange?: (dirty: boolean) => void;
  /** 面板保存／回退接口注册（壳层未保存确认弹窗的三路行为）。 */
  onRegisterActions?: (actions: PanelUnsavedActions | null) => void;
}): ReactElement {
  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex min-h-0 flex-1 flex-col p-6">
          {/* 端点 / 技能 / 运行日志子页：面板吃满剩余高度（运行日志子页 2026-10-05 改版
              合并整面板后与其他两子页同构）、左右两栏／单列各自内部滚动。 */}
          <section
            className={cn("min-w-0 flex-1", "flex min-h-0 flex-col overflow-hidden")}
            aria-label="设置内容区"
          >
            {section === "endpoints" && (
              <>
                <h2 className="mb-4 shrink-0 text-t-2xl font-semibold">端点配置</h2>
                <div className="min-h-0 flex-1">
                  <EndpointConfigPanel
                    onSettingsDirtyChange={onSettingsDirtyChange}
                    onRegisterActions={onRegisterActions}
                  />
                </div>
              </>
            )}
            {section === "skills" && (
              <>
                <h2 className="mb-4 shrink-0 text-t-2xl font-semibold">技能</h2>
                <div className="min-h-0 flex-1">
                  <SkillsPanel
                    onSettingsDirtyChange={onSettingsDirtyChange}
                    onRegisterActions={onRegisterActions}
                  />
                </div>
              </>
            )}
            {section === "service" && (
              <>
                <h2 className="mb-4 text-t-2xl font-semibold">运行日志</h2>
                <ServicePanel />
              </>
            )}
          </section>
        </div>
      </div>
    </TooltipProvider>
  );
}
