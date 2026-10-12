import {
  ArrowLeftIcon,
  ImageIcon,
  Maximize2Icon,
  Minimize2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useState } from "react";
import {
  MediaLightbox,
  type MediaPreviewTarget,
} from "../../../components/media-lightbox";
import { Button } from "../../../components/ui/button";
import { Tip } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";
import type { BatchSelection, WorkdirBatches } from "../batching/BatchSelector";
import { CaptionPreview } from "../runs/CaptionPreview";
import { nextCompared } from "../runs/compare-picker";
import { ITEM_GROUPS, type ItemRow } from "../runs/items-state";
import { LiveOutput } from "../runs/live-output";

/** 产出区进行中态的逐字流（A2）；null＝本条不在产出中。 */
type LiveStream = { item: string; reasoning: string; content: string };

/**
 * 素材详情：预览头行（返回＋文件名＋宽×高＋折叠钮）＋媒体舞台＋警示行＋产出区（两态）。
 *
 * 稿口径（「条目预览媒体舞台」＋「产出区」两件合并）：像素读数搬到头行右端（不再做舞台内
 * 浮卡，白底浮卡坐在画布灰上会戳出亮斑）、只留宽×高；图片点击开大图（视频不接，原生控件
 * 已有全屏）；产出区跟着「正在被看的这一条」同屏——正在打标的那条出逐字流，其余读落盘 txt。
 */
export function MaterialDetail({
  identity,
  selected,
  asset,
  selection,
  batches,
  foldedItem,
  setFoldedItem,
  liveOutput,
  onBack,
  /** 窄屏展收的展开钮（状态住在页面层；稿 §22＝预览视图挂预览头行最左、居「返回概览」之前）。 */
  listToggle,
}: {
  identity: string;
  selected: ItemRow;
  asset: string | null;
  selection: BatchSelection | null;
  batches: WorkdirBatches["batches"] | undefined;
  foldedItem: string | null;
  setFoldedItem: Dispatch<SetStateAction<string | null>>;
  liveOutput: LiveStream | null;
  onBack: () => void;
  listToggle?: ReactNode;
}) {
  /** 舞台读数（宽×高）：媒体加载后现读，无需额外接口。换条目由调用方以 key 重挂本件复位。 */
  const [mediaSize, setMediaSize] = useState<{ w: number; h: number } | null>(null);
  /** 前端读不出（文件损坏／浏览器解不开）按地址记。 */
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [preview, setPreview] = useState<MediaPreviewTarget | null>(null);
  const [comparison, setComparison] = useState<string[]>([]);
  const batch = selection?.batchId ?? "";
  const available = (batches ?? []).filter(
    (entry) => entry.active && entry.id !== batch,
  );
  const compared = comparison.filter((id) =>
    available.some((entry) => entry.id === id),
  );
  const folded = foldedItem === `${identity}/${selected.item}`;
  /** 对比上限＝当前策略＋两套；到顶不置灰，踢最早加入的那套（⑥替换式）。 */
  const toggleCompared = (id: string) =>
    setComparison((previous) => nextCompared(previous, id));
  const showingLive = liveOutput !== null && liveOutput.item === selected.item;
  const hasStage =
    asset !== null && selected.status !== "missing" && selected.status !== "unimported";

  return (
    <>
      {/* 头行三档让位（⑥）：操作钮与读数恒完整，文件名先让位（flex-1＋截断＋悬停给全文）。 */}
      <div className="mb-3 flex min-w-0 items-center gap-3">
        {listToggle}
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeftIcon />
          返回概览
        </Button>
        <Tip label={selected.name}>
          <h2 className="min-w-0 flex-1 truncate text-t-md font-medium">
            {selected.name}
          </h2>
        </Tip>
        <span
          className={`shrink-0 text-t-sm ${selected.status === "done" ? "text-ok-ink" : selected.status === "failed" ? "text-bad-ink" : "text-text-3"}`}
        >
          {ITEM_GROUPS.find(([key]) => key === selected.status)?.[1] ?? selected.status}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {mediaSize && (
            <Tip label={`${mediaSize.w}×${mediaSize.h}`}>
              <span className="max-w-[12ch] truncate text-t-sm text-text-2 tabular-nums">
                {mediaSize.w}×{mediaSize.h}
              </span>
            </Tip>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={folded ? "展开素材" : "折叠为小图"}
            aria-expanded={!folded}
            onClick={() =>
              setFoldedItem((previous) =>
                previous === `${identity}/${selected.item}`
                  ? null
                  : `${identity}/${selected.item}`,
              )
            }
          >
            {folded ? <Maximize2Icon /> : <Minimize2Icon />}
          </Button>
        </span>
      </div>
      {hasStage && asset !== null && (
        // 折叠态＝§22 .stage-mini 40×40（媒体元素原地不重建，播放位置随之保住）。
        <div
          className={cn(
            "relative shrink-0 overflow-hidden border border-border",
            folded
              ? "size-10 rounded-md bg-card"
              : "h-96 w-full rounded-xl bg-muted/45",
          )}
        >
          {failedUrl !== null ? (
            // 读不出态（⑧）：警示图标＋一行字（§14 .note-inline--bad 族、不弹 Toast）。
            <div className="flex size-full flex-col items-center justify-center gap-2">
              <TriangleAlertIcon
                className={cn("text-text-4", folded ? "size-5" : "size-[46px]")}
                aria-hidden="true"
              />
              {!folded && <p className="text-t-sm text-bad-ink">文件不支持预览</p>}
            </div>
          ) : (
            <>
              {selected.media === "video" ? (
                <video
                  controls
                  src={asset}
                  aria-label={selected.name}
                  className="size-full object-contain"
                  onLoadedMetadata={(event) => {
                    const el = event.currentTarget;
                    setMediaSize({ w: el.videoWidth, h: el.videoHeight });
                  }}
                  onError={() => setFailedUrl(asset)}
                >
                  <track kind="captions" />
                </video>
              ) : (
                // 图片点击开大图（⑦）：折叠态同样给大图、关掉回折叠态；键盘走查用这枚钮，
                // 视频不接（原生控件已有全屏），故视频分支不套按钮。
                <button
                  type="button"
                  aria-label={`查看大图 ${selected.name}`}
                  className={cn(
                    "block size-full border-0 bg-transparent p-0",
                    folded ? "cursor-pointer" : "cursor-zoom-in",
                  )}
                  onClick={() =>
                    setPreview({ url: asset, kind: "image", name: selected.name })
                  }
                >
                  <img
                    src={asset}
                    alt={selected.name}
                    className={cn(
                      "size-full",
                      folded ? "object-cover" : "object-contain",
                    )}
                    onLoad={(event) => {
                      const el = event.currentTarget;
                      setMediaSize({ w: el.naturalWidth, h: el.naturalHeight });
                    }}
                    onError={() => setFailedUrl(asset)}
                  />
                </button>
              )}
              {/* 元信息未到（⑨）：媒体元素照样挂载，占位层绝对铺满居中图标（折叠态缩到 20px），读数到手即退。 */}
              {mediaSize === null && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 flex items-center justify-center"
                >
                  <ImageIcon
                    className={cn("text-text-4", folded ? "size-5" : "size-[46px]")}
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}
      {(selected.message || selected.reason) && (
        <p className="mt-3 text-warn-ink">{selected.message || selected.reason}</p>
      )}
      {showingLive && selection !== null && (
        <LiveOutput
          batch={selection.batchId}
          batches={batches ?? []}
          available={available}
          compared={compared}
          onToggleCompared={toggleCompared}
          liveOutput={liveOutput}
          unfolded={folded}
        />
      )}
      {!showingLive && selection !== null && selected.status !== "unimported" && (
        <CaptionPreview
          key={`${selection.workdirId}/${selection.batchId}/${selected.item}`}
          wid={selection.workdirId}
          batch={selection.batchId}
          row={selected}
          batches={batches}
          available={available}
          compared={compared}
          onToggleCompared={toggleCompared}
          unfolded={folded}
        />
      )}
      <MediaLightbox target={preview} onClose={() => setPreview(null)} />
    </>
  );
}
