/** 连接 · 端点配置 · 左列配置列表（列表头＋加号钮、单行配置行、三态同槽、窄屏展收两态）。 */
import { ArrowLeftIcon, PlusIcon } from "lucide-react";
import type { ReactElement, Ref } from "react";
import type { EndpointConfigSummary } from "../../../api";
import { Button } from "../../../components/ui/button";
import { Tip } from "../../../components/ui/tooltip";
import { useVscrollColumn } from "../../../components/vscroll";
import { cn } from "../../../lib/utils";

type ConfigListProps = {
  endpoints: EndpointConfigSummary[];
  loading: boolean;
  loadError: boolean;
  selected: string;
  onPick: (name: string) => void;
  onStartCreate: () => void;
  /** 窄屏展收（hook＝usePeekList）：窄屏默认收起（左列隐）；peek＝悬停／键盘唤起的
   *  暂展浮出层（280 叠详情上、详情不位移，左缘圆角＋浮层影）。宽屏两参恒 false。 */
  narrow: boolean;
  peek: boolean;
  /** 暂展收出口：层头返回钮点击（键盘路径焦点回展开钮由 hook 管）；指针移出浮出层立即回收。 */
  onPeekBack: () => void;
  onPeekLeave: () => void;
  /** 层头返回钮落点（键盘进暂展的首件）。 */
  backRef: Ref<HTMLButtonElement | null>;
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
  narrow,
  peek,
  onPeekBack,
  onPeekLeave,
  backRef,
}: ConfigListProps): ReactElement {
  const listRef = useVscrollColumn<HTMLDivElement>();
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 暂展层是浮出列表列（不整层可点），接指针只为「移出即收」这一收出口
    <div
      ref={listRef}
      id="endpoint-list"
      onMouseLeave={peek ? onPeekLeave : undefined}
      className={
        narrow && !peek
          ? "hidden"
          : cn(
              "vscroll-y flex min-h-0 flex-col gap-1 overflow-y-auto p-4",
              // 暂展＝浮出层叠在详情上（280 宽、左缘圆角＋浮层影——base.css §21 --peek 档）。
              narrow &&
                peek &&
                "absolute inset-y-0 left-0 z-2 w-70 rounded-l-(--r-md) bg-card shadow-(--sh-3)",
            )
      }
    >
      <div
        className={
          peek
            ? // 层头＝[返回钮 26＋间隙 8＋题字]：左内距归 0（返回钮左缘 16 与行盒同）、
              // 顶距 margin 承担＋撤 padding-top（层头盒与详情头行同位同高——base.css §21）。
              "mt-2 flex min-h-(--h-lg) items-center gap-2 pr-3"
            : "flex min-h-(--h-lg) items-center gap-2 px-3 pt-2"
        }
      >
        {peek && (
          <Tip label="收起列表">
            <Button
              ref={backRef}
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="收起列表"
              onClick={onPeekBack}
            >
              <ArrowLeftIcon />
            </Button>
          </Tip>
        )}
        <h3 className="text-t-md font-medium text-text-1">模型列表</h3>
        <Tip label="添加配置">
          <button
            type="button"
            aria-label="添加配置"
            onClick={onStartCreate}
            className="ml-auto flex size-[22px] flex-none items-center justify-center rounded-md text-text-3 select-none enabled:hover:bg-accent enabled:hover:text-text-1 [&_svg]:size-(--icon-sm)"
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
                <Tip label={item.name}>
                  <span className="min-w-0 truncate text-t-lg font-medium text-text-1">
                    {item.name}
                  </span>
                </Tip>
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}
