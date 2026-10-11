/** 对话列：题头（端点切换 + 新会话）+ 消息流 + 错误条 + 输入区（Skill 组合内聚）。 */
import { PlusIcon, SettingsIcon, XIcon } from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
  useState,
} from "react";
import type { EndpointConfigSummary, SkillInfo } from "../../../api";
import {
  CfgPopCheckRow,
  CfgPopContent,
  CfgPopHead,
  CfgPopStateRow,
} from "../../../components/cfg-pop";
import { HScroll } from "../../../components/hs-scroll";
import type { MediaPreviewTarget } from "../../../components/media-lightbox";
import { MediaLightbox } from "../../../components/media-lightbox";
import { NoteInline } from "../../../components/note-inline";
import { Button } from "../../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import {
  Tip,
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
  endpointsLoading,
  endpointsFailed,
  selectedEndpointId,
  endpointSaveError,
  skills,
  skillsLoading,
  skillsFailed,
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
  onSelectEndpoint,
  onEndpointsMenuOpen,
  onSkillsMenuOpen,
  onManageEndpoints,
  onManageSkills,
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
  endpointsLoading: boolean;
  endpointsFailed: boolean;
  /** 端点 chip 的页内选中 ID（空串 = 未选；显示按 ID 现查）。 */
  selectedEndpointId: string;
  /** 选端点触发的策略自动保存失败行（chip 右侧槽；下一次保存成功即清，空串＝无）。 */
  endpointSaveError: string;
  skills: SkillInfo[];
  skillsLoading: boolean;
  skillsFailed: boolean;
  skillIds: string[];
  /** 配置飞行中（策略应用 / 提示词保存任一）：端点切换器禁用。 */
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
  onSelectEndpoint: (cid: string) => void;
  /** 每次打开端点弹层重拉列表（打开＝重试）。 */
  onEndpointsMenuOpen: () => void;
  /** 每次打开 Skill 库弹层重拉列表（打开＝重试）。 */
  onSkillsMenuOpen: () => void;
  onManageEndpoints: () => void;
  onManageSkills: () => void;
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
  // 停用 skill 不展示（列表过滤，2026-09-26 用户裁）；计数取展示口径、不写库内总数。
  const visibleSkills = skills.filter((skill) => skill.enabled);
  const skillsCountKnown =
    !skillsFailed && !(skillsLoading && visibleSkills.length === 0);

  return (
    <section
      className="flex min-h-80 min-w-0 flex-col border-t border-border px-6 py-4 lg:min-h-0 lg:border-t-0 lg:border-l"
      aria-label="调试对话列"
    >
      <div className="flex min-w-0 items-center gap-3 pb-3">
        <h2 className="shrink-0 text-t-xl font-semibold">对话</h2>
        <EndpointSwitcher
          endpoints={endpoints}
          selectedId={selectedEndpointId}
          disabled={disabled}
          loading={endpointsLoading}
          failed={endpointsFailed}
          onMenuOpen={onEndpointsMenuOpen}
          onSelect={onSelectEndpoint}
          onManage={onManageEndpoints}
        />
        {endpointSaveError !== "" && (
          // chip 触发的保存失败行（端点切换弹层稿「chip 触发的保存失败」格）：
          // 落 chip 右侧弹性空白、保底宽 200px、chip 让位；单行省略＋悬停给全文。
          <Tip label={endpointSaveError}>
            <span
              role="alert"
              className="min-w-[200px] max-w-full truncate text-t-sm text-bad-ink"
            >
              {endpointSaveError}
            </span>
          </Tip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="新建会话"
              className="ml-auto"
              onClick={onNewSession}
            >
              <PlusIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>新建会话</TooltipContent>
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
        // 对话列反馈（对齐批 17·alert 退役 B 位）：消息流与输入区之间一行字，
        // 单行省略＋截断悬停全文；role="alert" 语义保住（NoteInline 默认 status）。
        <NoteInline kind="bad" role="alert" text={chatError} className="mt-3" />
      )}

      {/* 输入区 */}
      <InputArea
        actions={
          <DropdownMenu
            onOpenChange={(next) => {
              if (next) onSkillsMenuOpen();
            }}
          >
            <Tip label="添加 Skill">
              <DropdownMenuTrigger asChild>
                {/* 2026-10-02 定形：现役无禁用条件——族形态档（加号钮禁用）住 通用件/下拉选择器.html。 */}
                <Button variant="ghost" size="icon" aria-label="添加 Skill">
                  <PlusIcon />
                </Button>
              </DropdownMenuTrigger>
            </Tip>
            <CfgPopContent anchor="trigger" side="top" align="start">
              <CfgPopHead
                label={
                  skillsCountKnown
                    ? `Skill 库 · 共 ${visibleSkills.length} 条`
                    : "Skill 库"
                }
                action={{
                  label: "前往设置 · 技能",
                  icon: <SettingsIcon />,
                  onClick: onManageSkills,
                }}
              />
              <div className="max-h-80 overflow-y-auto">
                {skillsLoading && visibleSkills.length === 0 ? (
                  <CfgPopStateRow>正在读取…</CfgPopStateRow>
                ) : skillsFailed ? (
                  <CfgPopStateRow>Skill 读取失败</CfgPopStateRow>
                ) : visibleSkills.length === 0 ? (
                  <CfgPopStateRow>还没有可用的 Skill</CfgPopStateRow>
                ) : (
                  visibleSkills.map((skill) => (
                    <CfgPopCheckRow
                      key={skill.id}
                      checked={skillIds.includes(skill.id)}
                      disabled={controlsBusy}
                      onCheckedChange={() => onToggleSkill(skill.id)}
                      name={skill.name}
                      desc={skill.description}
                    />
                  ))
                )}
              </div>
            </CfgPopContent>
          </DropdownMenu>
        }
        selectedSkills={
          // 已选 Skill 胶囊条（对话态稿 composer 区同款）：单行横滚走 hs 定式
          // （DESIGN.md 3.3，HScroll——自绘拇指贴底重叠、hover 显、渐隐位置感知）。
          <HScroll className="flex-1">
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
                    className="text-text-4"
                    onClick={() => onToggleSkill(sid)}
                  >
                    <XIcon className="size-(--icon-sm)" />
                  </button>
                </span>
              );
            })}
          </HScroll>
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
