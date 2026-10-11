import { useState } from "react";
import { CleanupRunDialog } from "../workdir/CleanupRunDialog";

/**
 * 「运行记录文件损坏」的就地出口（ADR 2026-10-09「出口就地给」）。
 *
 * 红字整枚可点：固定短句不带后端长句（损坏说明由弹窗正文承载），hover 取加强红双值档；
 * 点开《清理运行记录弹窗》，清理成功后由调用方就地重拉本链路取数——红字随句自消，
 * 消失本身就是反馈，不再补 toast。
 */
export function JournalCorruptedLine({
  wid,
  run,
  onCleaned,
}: {
  wid: string;
  run: string;
  onCleaned: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="text-t-sm text-bad-ink underline hover:text-bad-ink-hover"
        onClick={() => setOpen(true)}
      >
        运行记录文件损坏
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
