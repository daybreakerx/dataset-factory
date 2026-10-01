/** 连接 · 端点配置 · 左列配置列表（标题计数、配置行、添加配置钮）。 */
import { PlusIcon } from "lucide-react";
import type { ReactElement } from "react";
import type { EndpointConfigSummary } from "../../../api";
import { Tip } from "../../../components/ui/tooltip";

type ConfigListProps = {
  endpoints: EndpointConfigSummary[];
  selected: string;
  onPick: (name: string) => void;
  onStartCreate: () => void;
};

/** 左列：每行带激活点与模型名，行尾虚线「添加配置」入口；列表区独立滚动。 */
export function ConfigList({
  endpoints,
  selected,
  onPick,
  onStartCreate,
}: ConfigListProps): ReactElement {
  return (
    <div className="flex min-h-0 flex-col p-2">
      <div className="flex items-baseline gap-2 px-3 pt-2.5 pb-1.5">
        <h3 className="text-t-md font-semibold">端点配置</h3>
        <span className="text-t-xs text-muted-foreground">{endpoints.length} 套</span>
      </div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1">
        {endpoints.map((item) => {
          const active = item.name === selected;
          return (
            <button
              key={item.name}
              type="button"
              onClick={() => onPick(item.name)}
              aria-current={active ? "true" : undefined}
              className={
                "relative block w-full rounded-md px-3 py-2.5 text-left transition-colors " +
                // 激活行 hover 保持蓝系（与导航同口径，2026-09-13 用户反馈）。
                (active ? "bg-primary/10 hover:bg-primary/15" : "hover:bg-accent")
              }
            >
              {active && (
                <span
                  className="absolute top-1 bottom-1 left-0 w-0.5 rounded-full bg-primary"
                  aria-hidden
                />
              )}
              <span className="flex items-center gap-2">
                <Tip label={item.is_active ? "当前使用" : ""}>
                  <span
                    className={
                      "size-2 rounded-full " +
                      (item.is_active ? "bg-success" : "bg-muted-foreground/30")
                    }
                  />
                </Tip>
                <span
                  className={`truncate text-t-md font-medium${active ? " text-primary" : ""}`}
                >
                  {item.name}
                </span>
              </span>
              <span className="mt-0.5 block truncate pl-4 text-t-sm text-muted-foreground">
                {item.model}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={onStartCreate}
          className="mt-1 flex w-full items-center gap-2 rounded-md border border-dashed border-border px-3 py-2.5 text-t-md text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
        >
          <PlusIcon className="size-4" /> 添加配置
        </button>
      </div>
    </div>
  );
}
