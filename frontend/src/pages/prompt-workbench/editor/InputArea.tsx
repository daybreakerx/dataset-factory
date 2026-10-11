/** 输入区：打标指令文本框 + 附件选择 + 视频抽帧参数 + 发送/停止一体钮。 */
import {
  ArrowUpIcon,
  FilmIcon,
  PaperclipIcon,
  PlayIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useRef,
} from "react";
import type { MediaPreviewTarget } from "../../../components/media-lightbox";
import { Button } from "../../../components/ui/button";
import {
  Tip,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip";
import { durationBadge, formatBytesAuto } from "../../../lib/format";
import { cn } from "../../../lib/utils";
import type { PendingMedia } from "../../../session/types";

/** MIME → 简短类型标注（待发附件卡信息行；原型口径：JPG · 842 KB 这类一眼可读的摘要）。 */
function mimeLabel(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "JPG",
    "image/png": "PNG",
    "image/webp": "WEBP",
    "image/gif": "GIF",
    "video/mp4": "MP4",
    "video/quicktime": "MOV",
    "video/webm": "WEBM",
    "video/x-msvideo": "AVI",
    "video/x-matroska": "MKV",
    "video/x-m4v": "M4V",
  };
  return map[mime] ?? mime;
}

export function InputArea({
  instruction,
  onInstructionChange,
  onInstructionKeyDown,
  media,
  onPickMedia,
  onMediaFpsChange,
  onMediaMaxFramesChange,
  onClearMedia,
  canSend,
  sending,
  onSend,
  onStop,
  onPreview,
  actions,
  selectedSkills,
}: {
  instruction: string;
  onInstructionChange: (value: string) => void;
  onInstructionKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  media: PendingMedia | null;
  onPickMedia: (event: ChangeEvent<HTMLInputElement>) => void;
  onMediaFpsChange: (fps: number) => void;
  onMediaMaxFramesChange: (maxFrames: number) => void;
  onClearMedia: () => void;
  canSend: boolean;
  sending: boolean;
  onSend: () => void;
  /** 停止生成：生成中发送钮变形为停止钮，点击走这里。 */
  onStop: () => void;
  /** 待发附件卡点击开大图预览。 */
  onPreview: (target: MediaPreviewTarget) => void;
  actions?: ReactNode;
  selectedSkills?: ReactNode;
}): ReactElement {
  const fileInput = useRef<HTMLInputElement>(null);
  const dur =
    media !== null && media.kind === "video" ? durationBadge(media.durationSec) : null;
  return (
    <div className="mt-auto pt-4">
      <div className="rounded-xl border border-input bg-card p-2 focus-within:border-n-400">
        {media !== null && (
          <div
            className={cn(
              "relative mb-1 flex w-fit max-w-full items-center gap-2 rounded-lg border border-border bg-muted/40 p-1 text-t-sm",
              media.kind === "video" && "pr-2",
            )}
          >
            <button
              type="button"
              aria-label={`预览 ${media.name}`}
              className="shrink-0 cursor-zoom-in"
              onClick={() =>
                onPreview({
                  url: media.dataUrl,
                  kind: media.kind,
                  name: media.name,
                  ...(media.kind === "video" && media.posterUrl !== undefined
                    ? { posterUrl: media.posterUrl }
                    : {}),
                })
              }
            >
              {media.kind === "image" ? (
                <span className="relative flex size-10 items-center justify-center overflow-hidden rounded-lg bg-muted">
                  <img
                    className="size-full object-cover"
                    src={media.dataUrl}
                    alt={`待打标图片 ${media.name}`}
                  />
                </span>
              ) : media.posterUrl !== undefined ? (
                <span className="relative flex size-10 items-center justify-center overflow-hidden rounded-lg bg-muted">
                  <img
                    className="size-full object-cover"
                    src={media.posterUrl}
                    alt={`待打标视频 ${media.name}`}
                  />
                  <span className="absolute flex size-4 items-center justify-center rounded-sm bg-black/58 text-white">
                    <PlayIcon className="size-2.5" />
                  </span>
                  {dur !== null && (
                    <span className="absolute right-0.5 bottom-0.5 rounded-sm bg-black/58 px-1 text-[10px] leading-4 text-white">
                      {dur}
                    </span>
                  )}
                </span>
              ) : (
                <span className="relative flex size-10 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
                  <FilmIcon className="size-6" />
                  {dur !== null && (
                    <span className="absolute right-0.5 bottom-0.5 rounded-sm bg-black/58 px-1 text-[10px] leading-4 text-white">
                      {dur}
                    </span>
                  )}
                </span>
              )}
            </button>
            <div className="flex min-w-0 flex-col gap-1">
              <Tip label={media.name}>
                <div className="max-w-[172px] truncate">{media.name}</div>
              </Tip>
              <div className="text-t-xs text-muted-foreground">
                {mimeLabel(media.mime)} · {formatBytesAuto(media.byteSize)}
              </div>
              {media.kind === "video" && (
                <div className="flex flex-wrap items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <label className="flex items-center gap-1 text-muted-foreground">
                        fps
                        <input
                          type="number"
                          min={1}
                          max={10}
                          step={1}
                          value={media.fps}
                          onChange={(event) =>
                            onMediaFpsChange(Number(event.currentTarget.value))
                          }
                          className="h-(--h-xs) w-12 rounded-md border border-input bg-card px-1 text-t-sm"
                          aria-label="视频抽帧 fps"
                        />
                      </label>
                    </TooltipTrigger>
                    <TooltipContent>每秒抽帧数：动作越快需要的 fps 越高</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <label className="flex items-center gap-1 text-muted-foreground">
                        帧上限
                        <input
                          type="number"
                          min={1}
                          max={256}
                          value={media.maxFrames}
                          onChange={(event) =>
                            onMediaMaxFramesChange(Number(event.currentTarget.value))
                          }
                          className="h-(--h-xs) w-12 rounded-md border border-input bg-card px-1 text-t-sm"
                          aria-label="视频抽帧帧数上限"
                        />
                      </label>
                    </TooltipTrigger>
                    <TooltipContent>单条视频最多抽多少帧</TooltipContent>
                  </Tooltip>
                </div>
              )}
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                {/* 右上角角标圆钮：视觉 16／热区 24（::before 外扩，热区越出可见边界）。 */}
                <button
                  type="button"
                  aria-label="移除附件"
                  onClick={onClearMedia}
                  className="absolute top-[-6px] right-[-6px] flex size-4 cursor-pointer items-center justify-center rounded-full border border-card bg-n-900/72 p-0 text-background before:absolute before:inset-[-5px] before:rounded-full before:content-[''] hover:bg-n-900"
                >
                  <XIcon className="size-[9px]" aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent>移除附件</TooltipContent>
            </Tooltip>
          </div>
        )}
        <textarea
          aria-label="打标指令"
          placeholder="输入指令，继续交互……（如：把「燕麦色」改成具体的色号）"
          className="block min-h-14 w-full resize-none border-0 bg-transparent px-1 pt-2 pb-1 text-t-md text-text-2 outline-none"
          value={instruction}
          onInput={(event) => onInstructionChange(event.currentTarget.value)}
          onKeyDown={onInstructionKeyDown}
        />
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="附图片或视频（最多 1 个）"
                  onClick={() => fileInput.current?.click()}
                >
                  <PaperclipIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>附图片或视频（最多 1 个）</TooltipContent>
            </Tooltip>
            <input
              ref={fileInput}
              type="file"
              accept="image/*,video/mp4,video/quicktime,video/webm,video/x-msvideo,video/x-matroska,video/x-m4v"
              className="sr-only"
              aria-label="附图或视频（最多 1 个）"
              onChange={onPickMedia}
            />
            {actions}
          </div>
          {selectedSkills}
          <span className="ml-auto shrink-0 text-t-sm text-muted-foreground">
            Enter 发送 · Shift+Enter 换行
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              {/* 发送钮即停止钮：生成中同一颗钮变形为方块停止形态，
                  点击中止本轮；不再有独立的停止按钮与等待计时文字（状态收敛到消息流）。 */}
              <Button
                type="button"
                size="icon"
                variant="default"
                className="shrink-0 rounded-full"
                aria-label={sending ? "停止生成" : "发送"}
                disabled={!sending && !canSend}
                onClick={sending ? onStop : onSend}
              >
                {sending ? (
                  <SquareIcon className="size-(--icon-sm)" />
                ) : (
                  <ArrowUpIcon />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{sending ? "停止生成" : "发送"}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
