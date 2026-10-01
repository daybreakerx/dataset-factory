/** 对话列：题头（端点切换 + 新会话）+ 消息流 + 错误条 + 输入区（Skill 组合内聚）。 */
import { PlusIcon, XIcon } from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
  useState,
} from "react";
import type { EndpointConfigSummary, SkillInfo } from "../../../api";
import type { MediaPreviewTarget } from "../../../components/media-lightbox";
import { MediaLightbox } from "../../../components/media-lightbox";
import { Alert, AlertDescription } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip";
import type { ChatMessage, PendingMedia } from "../../../session/types";
import { InputArea } from "../editor/InputArea";
import { EndpointSwitcher } from "../strategy/EndpointSwitcher";
import { MessageList } from "./MessageList";

/** 对话列整块（工作台右列）。事件走回调 props；配置忙态由页面判定后传入。 */
export function ChatColumn({
  endpoints,
  skills,
  skillIds,
  disabled,
  controlsBusy,
  canSend,
  messages,
  streaming,
  waitSeconds,
  copiedId,
  chatError,
  instruction,
  media,
  sending,
  onActivateEndpoint,
  onManageEndpoints,
  onNewSession,
  onCopy,
  onToggleSkill,
  onInstructionChange,
  onInstructionKeyDown,
  onPickMedia,
  onMediaFpsChange,
  onMediaMaxFramesChange,
  onClearMedia,
  onSend,
  onStop,
}: {
  endpoints: EndpointConfigSummary[];
  skills: SkillInfo[];
  skillIds: string[];
  /** 配置飞行中（端点激活 / 策略应用 / 提示词保存任一）：端点切换器禁用。 */
  disabled: boolean;
  /** 发送或任一配置飞行中：Skill 勾选项整体禁用。 */
  controlsBusy: boolean;
  canSend: boolean;
  messages: ChatMessage[];
  streaming: { reasoning: string; content: string } | null;
  waitSeconds: number;
  copiedId: number | null;
  chatError: string;
  instruction: string;
  media: PendingMedia | null;
  sending: boolean;
  onActivateEndpoint: (cid: string) => void;
  onManageEndpoints: () => void;
  onNewSession: () => void;
  onCopy: (message: ChatMessage) => void;
  onToggleSkill: (sid: string) => void;
  onInstructionChange: (value: string) => void;
  onInstructionKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onPickMedia: (event: ChangeEvent<HTMLInputElement>) => void;
  onMediaFpsChange: (fps: number) => void;
  onMediaMaxFramesChange: (maxFrames: number) => void;
  onClearMedia: () => void;
  onSend: () => void;
  onStop: () => void;
}): ReactElement {
  // 媒体大图预览：消息流缩略图与待发附件卡的共同出口。
  const [preview, setPreview] = useState<MediaPreviewTarget | null>(null);

  return (
    <section
      className="flex min-h-80 min-w-0 flex-col border-t border-border px-6 py-4 lg:min-h-0 lg:border-t-0 lg:border-l"
      aria-label="调试对话列"
    >
      <div className="flex min-w-0 items-center gap-3 pb-3">
        <h2 className="shrink-0 text-t-xl font-semibold">对话</h2>
        <EndpointSwitcher
          endpoints={endpoints}
          disabled={disabled}
          onActivate={onActivateEndpoint}
          onManage={onManageEndpoints}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="清空当前会话"
              className="ml-auto"
              onClick={onNewSession}
            >
              <PlusIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>清空当前会话（旧会话仍保存在磁盘上）</TooltipContent>
        </Tooltip>
      </div>

      {/* 消息流 */}
      <MessageList
        messages={messages}
        streaming={streaming}
        waitSeconds={waitSeconds}
        copiedId={copiedId}
        onCopy={onCopy}
        onPreview={setPreview}
      />

      {chatError !== "" && (
        <Alert variant="destructive" className="mt-3">
          <AlertDescription>{chatError}</AlertDescription>
        </Alert>
      )}

      {/* 输入区 */}
      <InputArea
        actions={
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="添加 Skill">
                    <PlusIcon />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>添加 Skill</TooltipContent>
            </Tooltip>
            <DropdownMenuContent
              side="top"
              align="start"
              className="max-h-60 w-64 overflow-y-auto"
            >
              <DropdownMenuLabel>Skill 库 · 共 {skills.length} 条</DropdownMenuLabel>
              {skills.map((skill) => (
                <DropdownMenuCheckboxItem
                  key={skill.id}
                  checked={skillIds.includes(skill.id)}
                  disabled={!skill.enabled || controlsBusy}
                  onSelect={(event) => {
                    event.preventDefault();
                    onToggleSkill(skill.id);
                  }}
                >
                  <span className="truncate">
                    {skill.name}
                    {skill.enabled ? "" : "（已停用）"}
                  </span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        }
        selectedSkills={
          <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
            {skillIds.map((sid) => {
              const label = skills.find((entry) => entry.id === sid)?.name ?? sid;
              return (
                <span
                  key={sid}
                  className="inline-flex h-(--h-xs) shrink-0 items-center gap-1 rounded-full border border-border px-2 text-t-sm"
                >
                  {label}
                  <button
                    type="button"
                    aria-label={`移除 Skill ${label}`}
                    onClick={() => onToggleSkill(sid)}
                  >
                    <XIcon className="size-3.5" />
                  </button>
                </span>
              );
            })}
          </div>
        }
        instruction={instruction}
        onInstructionChange={onInstructionChange}
        onInstructionKeyDown={onInstructionKeyDown}
        media={media}
        onPickMedia={onPickMedia}
        onMediaFpsChange={onMediaFpsChange}
        onMediaMaxFramesChange={onMediaMaxFramesChange}
        onClearMedia={onClearMedia}
        canSend={canSend}
        sending={sending}
        onSend={onSend}
        onStop={onStop}
        onPreview={setPreview}
      />

      <MediaLightbox target={preview} onClose={() => setPreview(null)} />
    </section>
  );
}
