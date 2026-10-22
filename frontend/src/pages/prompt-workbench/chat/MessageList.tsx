/** 消息流：历史消息渲染 + 流式增量面板（本轮生成中的临时消息）+ 媒体大图预览挂点。 */
import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  FilmIcon,
  ImageIcon,
  PlayIcon,
} from "lucide-react";
import type { ReactElement } from "react";
import type { MediaPreviewTarget } from "../../../components/media-lightbox";
import { MediaThumb } from "../../../components/media-thumb";
import { Button } from "../../../components/ui/button";
import { Tip } from "../../../components/ui/tooltip";
import { durationBadge, formatDuration } from "../../../lib/format";
import logo from "../../../logo-speed-d.png";
import { type ChatMessage, PARTIAL_STOPPED_REASON } from "../../../session/types";

/** 视频扩展名清单（与后端 MIME 映射同源：llm/messages.py 的 VIDEO_MIME_BY_SUFFIX）：历史消息只带文件名，靠它认素材类型。 */
const VIDEO_EXTENSIONS = [".mp4", ".m4v", ".mov", ".webm", ".avi", ".mkv"];

function isVideoAttachment(name: string): boolean {
  const lowered = name.toLowerCase();
  return VIDEO_EXTENSIONS.some((extension) => lowered.endsWith(extension));
}

/** AI 回复的整框（原型 v20 `.ai-box`）：白底无边框、大圆角 + 左下角 4px，思考与正文同框。 */
function AiBox({ children }: { children: React.ReactNode }): ReactElement {
  return (
    <div className="max-w-[94%] overflow-hidden rounded-xl rounded-bl-sm bg-card">
      {children}
    </div>
  );
}

/**
 * 思考过程折叠区（AI 整框内的透明分区，原型 `.ai-box > .think`）。
 *
 * 流式期间恒展开（N1③），结束后收起可回看；与正文之间的横线由 AiBox 内容层
 * 按「两侧都有内容」显式渲染，这里不画——仅思考无正文的半截消息不出悬空线。
 * 时间槽：思考期由调用方传累加秒数（2026-09-25 用户裁「计时进思考头时间槽」），
 * 结束后传入定格值。
 */
function Thinking({
  reasoning,
  streaming,
  seconds,
}: {
  reasoning: string | null | undefined;
  streaming?: boolean;
  seconds?: number;
}): ReactElement | null {
  if (reasoning === null || reasoning === undefined || reasoning === "") {
    return null;
  }
  return (
    <details className="group" {...(streaming ? { open: true } : {})}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-t-sm text-text-3 hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronDownIcon
          className="size-(--icon-md) shrink-0 transition-transform duration-150 group-open:rotate-180"
          aria-hidden
        />
        <span className="font-medium">思考过程</span>
        {seconds !== undefined ? (
          <span className="ml-auto tabular-nums">
            已思考 {formatDuration(seconds * 1000)}
          </span>
        ) : null}
      </summary>
      <p className="px-3 pb-3 text-t-md leading-(--lh-loose) text-text-3 wrap-anywhere whitespace-pre-wrap">
        {reasoning}
      </p>
    </details>
  );
}

/** 用户消息的附件缩略图：当轮有封面/字节、历史有字节地址，都没有再落图标。点击开大图预览。 */
function AttachmentThumb({
  message,
  onPreview,
}: {
  message: ChatMessage;
  onPreview: (target: MediaPreviewTarget) => void;
}): ReactElement {
  if (message.attachment === null) {
    return <span />;
  }
  const video = isVideoAttachment(message.attachment);
  const src = message.attachmentDataUrl ?? message.attachmentUrl;
  const cover = message.attachmentPosterUrl;
  const badge = video ? durationBadge(message.attachmentDurationSec) : null;
  const preview: MediaPreviewTarget | null =
    src === undefined
      ? null
      : {
          url: src,
          kind: video ? "video" : "image",
          name: message.attachment,
          ...(cover !== undefined ? { posterUrl: cover } : {}),
        };
  return (
    <Tip label={message.attachment}>
      <button
        type="button"
        aria-label={
          preview !== null ? `预览 ${message.attachment}` : message.attachment
        }
        disabled={preview === null}
        onClick={() => {
          if (preview !== null) onPreview(preview);
        }}
        className="relative flex size-14 cursor-zoom-in items-center justify-center overflow-hidden rounded-lg bg-muted shadow-xs disabled:cursor-default"
      >
        {video ? (
          cover !== undefined ? (
            <>
              <img src={cover} alt="" className="size-full object-cover" />
              <span className="absolute flex size-4 items-center justify-center rounded-sm bg-black/58 text-white">
                <PlayIcon className="size-2.5" />
              </span>
            </>
          ) : message.attachmentUrl !== undefined ? (
            <MediaThumb
              src={message.attachmentUrl}
              kind="video"
              fallback={<FilmIcon className="size-5 text-text-3" />}
            />
          ) : (
            // 当轮没抽到封面 = 本浏览器解不了这段视频（同一套解码器），<video> 兜底没有意义。
            <FilmIcon className="size-5 text-text-3" />
          )
        ) : src !== undefined ? (
          <MediaThumb
            src={src}
            kind="image"
            fallback={<ImageIcon className="size-5 text-text-3" />}
          />
        ) : (
          <ImageIcon className="size-5 text-text-3" />
        )}
        {badge !== null && (
          <span className="absolute right-0.5 bottom-0.5 rounded-sm bg-black/58 px-1 text-[10px] leading-4 text-white">
            {badge}
          </span>
        )}
      </button>
    </Tip>
  );
}

/**
 * meta 行的时钟：本轮新消息用客户端 createdAt，历史消息用后端事件 ts（UTC ISO 8601，
 * Date 解析后按本地时区显示）；两路共用同一份 locale 形态。无效时间戳不出时钟。
 */
function Clock({ message }: { message: ChatMessage }): ReactElement | null {
  const at =
    message.createdAt ?? (message.ts != null ? new Date(message.ts) : undefined);
  if (at === undefined || Number.isNaN(at.getTime())) return null;
  return (
    <span>
      {at.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}

export function MessageList({
  messages,
  streaming,
  waitSeconds,
  copiedId,
  onCopy,
  onPreview,
}: {
  messages: ChatMessage[];
  streaming: { reasoning: string; content: string } | null;
  waitSeconds: number;
  copiedId: number | null;
  onCopy: (message: ChatMessage) => void;
  onPreview: (target: MediaPreviewTarget) => void;
}): ReactElement {
  return (
    <div
      role="log"
      aria-label="消息流"
      className="min-h-0 flex-1 space-y-4 overflow-y-auto px-0.5 py-1"
    >
      {messages.length === 0 && (
        <p className="mt-8 text-center text-t-sm text-text-3">
          暂无消息。本页只显示最近一次会话。
        </p>
      )}
      {messages.map((message) =>
        message.role === "user" ? (
          <div key={message.id} className="flex justify-end">
            {/* 原型口径：附件在气泡外上方；仅附件不打字时只显示缩略图，不出空气泡 */}
            <div className="flex max-w-[94%] min-w-0 flex-col items-end gap-1">
              {message.attachment !== null && (
                <AttachmentThumb message={message} onPreview={onPreview} />
              )}
              {message.text !== "" && (
                <div className="rounded-xl rounded-br-sm bg-primary/10 px-4 py-3 text-t-md wrap-anywhere whitespace-pre-wrap dark:bg-primary/26">
                  {message.text}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div key={message.id} className="flex items-start">
            <span
              className="mt-0.5 mr-3 flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-black"
              aria-hidden
            >
              <img src={logo} className="size-5 object-contain" alt="" />
            </span>
            <div className="min-w-0 flex-1">
              {(() => {
                const hasReasoning =
                  message.reasoning !== null &&
                  message.reasoning !== undefined &&
                  message.reasoning !== "";
                const hasText = message.text !== "";
                if (!hasReasoning && !hasText) return null;
                return (
                  <AiBox>
                    {hasReasoning && (
                      <Thinking
                        reasoning={message.reasoning}
                        seconds={
                          message.reasoningSeconds ??
                          (message.reasoning_ms !== null &&
                          message.reasoning_ms !== undefined
                            ? message.reasoning_ms / 1000
                            : undefined)
                        }
                      />
                    )}
                    {hasReasoning && hasText && (
                      <div className="mx-4 h-px bg-border" aria-hidden />
                    )}
                    {hasText && (
                      <div className="px-4 py-3 text-t-md wrap-anywhere whitespace-pre-wrap">
                        {message.text}
                      </div>
                    )}
                  </AiBox>
                );
              })()}
              <div className="mt-2 flex flex-wrap items-center gap-3 text-t-sm text-muted-foreground">
                {message.partial === true &&
                  (message.partial_reason === PARTIAL_STOPPED_REASON ? (
                    // 手动停止＝用户自己的动作、非失败：琥珀档（2026-10-04 用户裁）。
                    <span className="shrink-0 text-t-xs text-warn-ink">
                      已停止 · 仅保留已收到的部分
                    </span>
                  ) : (
                    <span className="shrink-0 text-t-xs text-bad-ink">
                      {message.partial_reason
                        ? `生成中断 · ${message.partial_reason}，仅保留已收到的部分`
                        : // 旧数据无中断原因：不硬凑原因段。
                          "生成中断 · 仅保留已收到的部分"}
                    </span>
                  ))}
                <Clock message={message} />
                {(message.durationSeconds !== undefined ||
                  (message.elapsed_ms !== null &&
                    message.elapsed_ms !== undefined)) && (
                  <span>
                    {message.durationSeconds !== undefined
                      ? formatDuration(message.durationSeconds * 1000)
                      : message.elapsed_ms !== null && message.elapsed_ms !== undefined
                        ? formatDuration(message.elapsed_ms)
                        : null}
                  </span>
                )}
                <Tip label={copiedId === message.id ? "已复制" : "复制"}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="复制 caption"
                    onClick={() => onCopy(message)}
                  >
                    {copiedId === message.id ? <CheckIcon /> : <CopyIcon />}
                  </Button>
                </Tip>
              </div>
            </div>
          </div>
        ),
      )}
      {streaming !== null && (
        <div className="flex items-start">
          <span
            className="mt-0.5 mr-3 flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-black"
            aria-hidden
          >
            <img src={logo} className="size-5 object-contain" alt="" />
          </span>
          <div className="min-w-0 flex-1">
            <AiBox>
              {/* 思考期计时进思考头时间槽累加（2026-09-25 用户裁）：正文未到时传累加秒数。 */}
              <Thinking
                reasoning={streaming.reasoning}
                streaming={true}
                seconds={streaming.content === "" ? waitSeconds : undefined}
              />
              {streaming.reasoning !== "" && streaming.content !== "" && (
                <div className="mx-4 h-px bg-border" aria-hidden />
              )}
              {streaming.content === "" ? (
                // 状态行仅「响应中」（尚无任何增量）阶段存在（N1②）；思考流入后
                // 计时交给思考头时间槽，此行消失。
                streaming.reasoning === "" && (
                  <div className="px-4 py-3 text-t-md text-text-4 tabular-nums">
                    响应中 · 已用时 {waitSeconds}s
                  </div>
                )
              ) : (
                <div className="px-4 py-3 text-t-md wrap-anywhere whitespace-pre-wrap">
                  {streaming.content}
                </div>
              )}
            </AiBox>
            {streaming.content !== "" && (
              <div className="mt-2 text-t-sm text-text-4 tabular-nums">
                生成中 · 已用时 {waitSeconds}s
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
