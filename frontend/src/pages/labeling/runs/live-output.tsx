import { ChevronDownIcon } from "lucide-react";
import type { components } from "../../../api-types.gen";
import { cn } from "../../../lib/utils";
import { ComparePicker } from "./compare-picker";

interface Props {
  batch: string;
  batches: readonly components["schemas"]["BatchView"][];
  available: components["schemas"]["BatchView"][];
  compared: string[];
  onToggleCompared: (id: string) => void;
  /** 跑批中的「当前产出」逐字流（A2）；本件只在有产出流的那一条上挂载。 */
  liveOutput: { item: string; reasoning: string; content: string };
  /** 媒体舞台折叠态：解除正文 180px 上限、吃满剩余空间（稿 §23 .capbox--unfolded）。 */
  unfolded: boolean;
}

/**
 * 产出区·进行中态（稿「产出区」格 ①—⑤，§23 live 族）：题字行＋思考折叠区＋正文槽逐字追加。
 *
 * 落位在条目预览视图、媒体舞台之下（①）——产出讲的是「正在被看的这一条」，两态同处一屏；
 * 逐字流只走 SSE 不落盘，关掉页面再打开就没有这段内容。
 */
export function LiveOutput({
  batch,
  batches,
  available,
  compared,
  onToggleCompared,
  liveOutput,
  unfolded,
}: Props) {
  return (
    // .live-box＝白卡（§18 .ai-box 同底同圆角档）
    <section
      className="mt-4 rounded-xl border border-border bg-card p-4"
      aria-label="当前产出"
    >
      {/* .live-head：题字 flex-none 恒不让位＋右端策略对比 chips（两态都恒出，⑨） */}
      <div className="mb-2 flex min-w-0 items-baseline gap-3">
        <h3 className="shrink-0 text-t-md font-medium">当前产出</h3>
        {!!available.length && (
          <ComparePicker
            batch={batch}
            batches={batches}
            available={available}
            compared={compared}
            onToggle={onToggleCompared}
          />
        )}
      </div>
      {liveOutput.reasoning !== "" && (
        // .think：自带 --muted/40 底＋r-lg＋无分隔线（思考区与正文不同框）
        <details className="mb-3 rounded-xl border border-border bg-muted/40">
          {/* .think-head：t-sm／--text-3／图标 --icon-sm；label medium。机制说明句已撤（②）。 */}
          <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-t-sm text-text-3 hover:text-text-1">
            <ChevronDownIcon className="size-(--icon-sm) shrink-0" />
            <span className="font-medium">思考过程</span>
          </summary>
          <p className="px-3 pb-3 text-t-md leading-(--lh-loose) text-text-3 whitespace-pre-wrap">
            {liveOutput.reasoning}
          </p>
        </details>
      )}
      {liveOutput.content === "" ? (
        // .live-wait：已发出、正等第一个字（不是左列的「排队中」）；t-md／--text-4。
        <p className="text-t-md text-text-4">正在组装请求…</p>
      ) : (
        <p
          className={cn(
            "text-t-md leading-(--lh-loose) text-foreground whitespace-pre-wrap",
            !unfolded && "max-h-[180px] overflow-y-auto",
          )}
        >
          {liveOutput.content}
        </p>
      )}
    </section>
  );
}
