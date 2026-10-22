import { TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { Tip } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";
import { CleanupRunDialog } from "../workdir/CleanupRunDialog";

/**
 * 「运行记录文件损坏」的就地出口（ADR 2026-10-09「出口就地给」）。
 *
 * 红字整枚可点：固定短句不带后端长句（损坏说明由弹窗正文承载），hover 取加强红双值档；
 * 点开《清理运行记录弹窗》，清理成功后由调用方就地重拉本链路取数——红字随句自消，
 * 消失本身就是反馈，不再补 toast。
 *
 * 窄态图标档（base.css §22 `.lb-runerr-act`，仅顶栏 lbctx 容器内生效）：≤663 时文字隐、
 * 14px 红三角显（带同参下划线、命中区外扩 5px、全文进 Tip 与 aria-label）——由调用方传
 * `iconTier` 开启（运行状态组内）。**独件恒文字**（稿样图 16）：组内仅此一行时（已完成态
 * 的最小例外）不传该档，窄态也保留文字——孤零零一枚图标不如文字自解释。
 */
export function JournalCorruptedLine({
  wid,
  run,
  onCleaned,
  className,
  iconTier = false,
}: {
  wid: string;
  run: string;
  onCleaned: () => void;
  /** 挂载位档：独立一行取默认（13px），概览分区头副行取 `text-t-xs`。 */
  className?: string;
  /** 窄态转图标档（§22 `.lb-runerr-act`）；独件态不传。 */
  iconTier?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={cn(
          "text-t-sm text-bad-ink underline hover:text-bad-ink-hover",
          iconTier &&
            "@max-[663px]/lbctx:relative @max-[663px]/lbctx:inline-flex @max-[663px]/lbctx:flex-none @max-[663px]/lbctx:items-center @max-[663px]/lbctx:before:absolute @max-[663px]/lbctx:before:-inset-[5px] @max-[663px]/lbctx:before:content-['']",
          className,
        )}
        onClick={() => setOpen(true)}
      >
        {iconTier && (
          <Tip label="运行记录文件损坏">
            <TriangleAlertIcon
              role="img"
              aria-label="运行记录文件损坏"
              className="hidden size-(--icon-md) shrink-0 @max-[663px]/lbctx:inline-flex @max-[663px]/lbctx:border-b @max-[663px]/lbctx:pb-0.5"
            />
          </Tip>
        )}
        <span className={cn(iconTier && "@max-[663px]/lbctx:hidden")}>
          运行记录文件损坏
        </span>
      </button>
      {open && (
        <CleanupRunDialog
          wid={wid}
          run={run}
          onClose={() => setOpen(false)}
          onCleaned={() => {
            setOpen(false);
            onCleaned();
          }}
        />
      )}
    </>
  );
}
