/** 连接 · 端点配置 · 左列配置列表（列表头＋加号钮、单行配置行、三态同槽）。 */
import { PlusIcon } from "lucide-react";
import type { ReactElement } from "react";
import type { EndpointConfigSummary } from "../../../api";
import { Tip } from "../../../components/ui/tooltip";
import { useVscrollColumn } from "../../../components/vscroll";

type ConfigListProps = {
  endpoints: EndpointConfigSummary[];
  loading: boolean;
  loadError: boolean;
  selected: string;
  onPick: (name: string) => void;
  onStartCreate: () => void;
};

/** 左列：整列内滚（自绘竖向滚动条），行＝选中浅灰描边环、悬停更浅环、单行式（模型信息在详情列）；
 *  取数中／空／取数失败三态同槽轮换、只换文案（components/list.md「列表列的三态」）。 */
export function ConfigList({
  endpoints,
  loading,
  loadError,
  selected,
  onPick,
  onStartCreate,
}: ConfigListProps): ReactElement {
  const listRef = useVscrollColumn<HTMLDivElement>();
  return (
    <div
      ref={listRef}
      className="vscroll-y flex min-h-0 flex-col gap-1 overflow-y-auto p-4"
    >
      <div className="flex min-h-(--h-lg) items-center gap-2 px-3 pt-2">
        <h3 className="text-t-md font-medium text-text-1">模型列表</h3>
        <Tip label="添加配置">
          <button
            type="button"
            aria-label="添加配置"
            onClick={onStartCreate}
            className="ml-auto flex size-[22px] flex-none items-center justify-center rounded-md text-text-3 select-none enabled:hover:bg-accent enabled:hover:text-text-1 [&_svg]:size-3.5"
          >
            <PlusIcon />
          </button>
        </Tip>
      </div>
      {endpoints.length === 0 ? (
        <div className="px-1 text-center text-t-sm text-text-3">
          {loadError ? "配置读取失败" : loading ? "正在读取…" : "未配置模型"}
        </div>
      ) : (
        endpoints.map((item) => {
          const active = item.id === selected;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onPick(item.id)}
              aria-current={active ? "true" : undefined}
              className={
                "block w-full rounded-md border px-3 py-2 text-left transition-colors " +
                // 描边环语言（2026-09-29 用户定稿）：静止无环 → 悬停 --border 更浅环
                // → 选中 --input 环；无底、名不变色，行与行 4px 间隙独立成格。
                (active ? "border-input" : "border-transparent hover:border-border")
              }
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 truncate text-t-lg font-medium text-text-1">
                  {item.name}
                </span>
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}
