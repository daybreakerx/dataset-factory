import { ArrowLeftIcon, Maximize2Icon, Minimize2Icon } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
import type { BatchSelection, WorkdirBatches } from "../batching/BatchSelector";
import { CaptionPreview } from "../runs/CaptionPreview";
import { ITEM_GROUPS, type ItemRow } from "../runs/items-state";

/** 素材详情：返回行＋媒体舞台（HUD 与折叠钮）＋警示行＋打标预览。 */
export function MaterialDetail({
  identity,
  selectedItem,
  selected,
  asset,
  selection,
  batches,
  foldedItem,
  setFoldedItem,
  onBack,
  onRetryChange,
}: {
  identity: string;
  selectedItem: string | null;
  selected: ItemRow;
  asset: string | null;
  selection: BatchSelection | null;
  batches: WorkdirBatches["batches"] | undefined;
  foldedItem: string | null;
  setFoldedItem: Dispatch<SetStateAction<string | null>>;
  onBack: () => void;
  onRetryChange: (retry: string[]) => void;
}) {
  /** 预览舞台 HUD 的媒体元信息：从加载后的媒体元素读取，无需额外接口。 */
  const [mediaMeta, setMediaMeta] = useState<{
    w: number;
    h: number;
    duration?: number;
  } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 换条目（identity 或选中项）即丢上一条的媒体元信息，等新媒体加载时重新读取。
  useEffect(() => {
    setMediaMeta(null);
  }, [identity, selectedItem]);

  return (
    <>
      <div className="mb-3 flex min-w-0 items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeftIcon />
          返回概览
        </Button>
        <h2 className="min-w-0 truncate text-t-md font-medium">{selected.name}</h2>
        <span
          className={`shrink-0 text-t-sm ${selected.status === "done" ? "text-ok-ink" : selected.status === "failed" ? "text-bad-ink" : "text-text-3"}`}
        >
          {ITEM_GROUPS.find(([key]) => key === selected.status)?.[1] ?? selected.status}
        </span>
      </div>
      {asset && selected.status !== "missing" && selected.status !== "unimported" && (
        <div
          className={`relative w-full shrink-0 overflow-hidden rounded-xl border border-border bg-muted/45 ${foldedItem === `${identity}/${selected.item}` ? "h-[76px]" : "h-96"}`}
        >
          {selected.media === "video" ? (
            <video
              controls
              src={asset}
              aria-label={selected.name}
              className="h-full w-full object-contain"
              onLoadedMetadata={(event) => {
                const el = event.currentTarget;
                setMediaMeta({
                  w: el.videoWidth,
                  h: el.videoHeight,
                  duration: el.duration,
                });
              }}
            >
              <track kind="captions" />
            </video>
          ) : (
            <img
              src={asset}
              alt={selected.name}
              className="h-full w-full object-contain"
              onLoad={(event) => {
                const el = event.currentTarget;
                setMediaMeta({ w: el.naturalWidth, h: el.naturalHeight });
              }}
            />
          )}
          <div
            className={`absolute right-3 flex items-center gap-1.5 rounded-md bg-card/95 py-1 pr-1 pl-2.5 text-t-xs text-text-3 shadow-(--sh-1) ${
              selected.media === "video" ? "bottom-14" : "bottom-3"
            }`}
          >
            {mediaMeta && (
              <span className="tabular-nums">
                {mediaMeta.w}×{mediaMeta.h}
                {mediaMeta.duration !== undefined
                  ? ` · ${mediaMeta.duration.toFixed(1)} 秒`
                  : ""}
                {` · ${(selected.name.split(".").pop() ?? "").toUpperCase()}`}
              </span>
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={
                foldedItem === `${identity}/${selected.item}`
                  ? "展开素材"
                  : "折叠为小图"
              }
              aria-expanded={foldedItem !== `${identity}/${selected.item}`}
              onClick={() =>
                setFoldedItem((previous) =>
                  previous === `${identity}/${selected.item}`
                    ? null
                    : `${identity}/${selected.item}`,
                )
              }
            >
              {foldedItem === `${identity}/${selected.item}` ? (
                <Maximize2Icon />
              ) : (
                <Minimize2Icon />
              )}
            </Button>
          </div>
        </div>
      )}
      {(selected.message || selected.reason) && (
        <p className="mt-3 text-warn-ink">{selected.message || selected.reason}</p>
      )}
      {selection && selected.status !== "unimported" && (
        <CaptionPreview
          key={`${selection.workdirId}/${selection.batchId}/${selected.item}`}
          wid={selection.workdirId}
          batch={selection.batchId}
          batches={batches}
          row={selected}
          onRetryChange={onRetryChange}
        />
      )}
    </>
  );
}
