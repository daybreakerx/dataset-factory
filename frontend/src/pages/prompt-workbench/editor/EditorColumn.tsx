/** 提示词编辑列（区块组件）：名称与提示词库、描述、正文与字节护栏、反馈与删除确认。 */
import { PlusIcon, Trash2Icon } from "lucide-react";
import { type ReactElement, type RefObject, useRef } from "react";
import type { PromptInfo } from "../../../api";
import {
  CfgNameChevron,
  CfgPopContent,
  CfgPopHead,
  CfgPopRow,
  CfgPopRowIconButton,
  CfgPopRowMain,
  CfgPopStateRow,
} from "../../../components/cfg-pop";
import { DialogShell } from "../../../components/dialog-shell";
import { Button } from "../../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Tip } from "../../../components/ui/tooltip";
import type { Feedback } from "../../../lib/feedback";
import { formatChars } from "../../../lib/format";
import { BodyEditor } from "./BodyEditor";

/** 基础提示词的正文护栏：32000 字符（32k 字，2026-10-04 裁 KiB 字节 → k 字符口径——
 *  展示与护栏同一口径，后端同值校验）。 */
const PROMPT_CHAR_BUDGET = 32_000;

/** 提示词库下拉弹层（本列私有件）：切换触发件＋库列表＋新建入口。族内实例（cfg-pop）——
 *  弹层壳／头行／行／三态行随 components/cfg-pop.tsx；触发件随族不再随未保存禁用
 *  （2026-10-05 随组件归一；点非当前行的拦截形态改确认保存弹窗，见对齐批）。 */
function PromptMenu({
  open,
  onOpenChange,
  prompts,
  selectedPromptId,
  loading,
  failed,
  wrapRef,
  onNew,
  onSelect,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompts: PromptInfo[];
  /** 当前编辑的提示词 ID（当前行 tint 强调的判据；空串＝新建草稿、无当前行）。 */
  selectedPromptId: string;
  loading: boolean;
  failed: boolean;
  /** 名字框承载块：弹层宽下限与贴边方向的基准（族宽三段式）。 */
  wrapRef: RefObject<HTMLDivElement | null>;
  onNew: () => void;
  /** 选中／删除一律传稳定 ID（显示名可重名——两个坏提示词同名占位「提示词已损坏」，
   *  按 name 寻址会撞键且后端重名解析不到）。 */
  onSelect: (pid: string) => void;
  onDelete: (pid: string) => void;
}): ReactElement {
  const triggerRef = useRef<HTMLButtonElement>(null);
  // 计数不可知（首取中／取数失败）时头行只写库名，不写假计数（overlay.md 头行条）。
  const countKnown = !failed && !(loading && prompts.length === 0);
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <CfgNameChevron ref={triggerRef} label="切换提示词" />
      </DropdownMenuTrigger>
      <CfgPopContent
        wrapRef={wrapRef}
        triggerRef={triggerRef}
        align="start"
        side="bottom"
      >
        <CfgPopHead
          label={countKnown ? `提示词库 · 共 ${prompts.length} 条` : "提示词库"}
          action={{
            label: "新建提示词",
            icon: <PlusIcon />,
            onClick: onNew,
          }}
        />
        <div className="max-h-80 overflow-y-auto">
          {loading && prompts.length === 0 ? (
            <CfgPopStateRow>正在读取…</CfgPopStateRow>
          ) : failed ? (
            <CfgPopStateRow>提示词读取失败</CfgPopStateRow>
          ) : prompts.length === 0 ? (
            <CfgPopStateRow>还没有可用的提示词</CfgPopStateRow>
          ) : (
            prompts.map((prompt) => (
              <CfgPopRow
                key={prompt.id}
                current={prompt.id === selectedPromptId}
                onSelect={() => {
                  // 点当前行＝无实质变化，随 Radix 选中默认关层即可（2026-10-05 用户裁）。
                  if (prompt.id === selectedPromptId) return;
                  onSelect(prompt.id);
                }}
              >
                <CfgPopRowMain
                  name={prompt.name}
                  count={formatChars(prompt.body_chars)}
                  desc={prompt.description}
                />
                <CfgPopRowIconButton
                  danger
                  label={`删除提示词 ${prompt.name}`}
                  tip="删除"
                  icon={<Trash2Icon />}
                  onClick={() => onDelete(prompt.id)}
                />
              </CfgPopRow>
            ))
          )}
        </div>
      </CfgPopContent>
    </DropdownMenu>
  );
}

export function EditorColumn({
  prompts,
  selectedPromptId,
  promptsLoading,
  promptsFailed,
  promptMenuOpen,
  onPromptMenuOpenChange,
  draftName,
  onDraftNameInput,
  draftDescription,
  onDraftDescriptionInput,
  draftBody,
  onDraftBodyChange,
  promptDirty,
  onNewDraft,
  onSelectPrompt,
  onDeletePromptRequest,
  onSave,
  editorFeedback,
  deleteDialogOpen,
  onDeleteDialogOpenChange,
  deleteName,
  deleteBusy,
  onDeleteConfirm,
}: {
  prompts: PromptInfo[];
  /** 当前编辑的提示词 ID（弹层当前行判据；空串＝新建草稿）。 */
  selectedPromptId: string;
  /** 提示词库取数中／取数失败（弹层三态行；打开即重拉的飞行态）。 */
  promptsLoading: boolean;
  promptsFailed: boolean;
  promptMenuOpen: boolean;
  onPromptMenuOpenChange: (open: boolean) => void;
  draftName: string;
  onDraftNameInput: (value: string) => void;
  draftDescription: string;
  onDraftDescriptionInput: (value: string) => void;
  draftBody: string;
  onDraftBodyChange: (body: string) => void;
  promptDirty: boolean;
  onNewDraft: () => void;
  onSelectPrompt: (name: string) => void;
  onDeletePromptRequest: (name: string) => void;
  onSave: () => void;
  editorFeedback: Feedback | null;
  deleteDialogOpen: boolean;
  onDeleteDialogOpenChange: (open: boolean) => void;
  deleteName: string;
  /** 删除请求飞行期：弹窗两钮只失效不换装＋关闭钮随态 Tip。 */
  deleteBusy: boolean;
  onDeleteConfirm: () => void;
}): ReactElement {
  // 正文按码点计数（Array.from＝Python len 同口径；.length 的 UTF-16 代理对会把
  // emoji 计成 2，与后端字符校验对不上）。
  const bodyChars = Array.from(draftBody).length;
  const charOver = bodyChars > PROMPT_CHAR_BUDGET;
  // 名字框承载块：提示词库弹层的宽度下限与贴边方向基准（族宽三段式）。
  const nameWrapRef = useRef<HTMLDivElement>(null);

  return (
    <section
      className="flex min-h-80 min-w-0 flex-col px-6 py-4 lg:min-h-0"
      aria-label="提示词编辑列"
    >
      <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border bg-card px-6 py-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-t-sm text-text-3">提示词</span>
          <div
            ref={nameWrapRef}
            className="relative flex min-w-0 max-w-full items-center"
          >
            <input
              id="prompt-name"
              aria-label="名称"
              value={draftName}
              placeholder="新建提示词"
              className="min-w-24 max-w-[380px] field-sizing-content rounded-md border border-transparent bg-transparent py-1 pr-7 pl-1 text-t-xl font-medium hover:border-input focus:border-n-400 focus:outline-none"
              onInput={(event) => onDraftNameInput(event.currentTarget.value)}
            />
            <PromptMenu
              open={promptMenuOpen}
              onOpenChange={onPromptMenuOpenChange}
              prompts={prompts}
              selectedPromptId={selectedPromptId}
              loading={promptsLoading}
              failed={promptsFailed}
              wrapRef={nameWrapRef}
              onNew={onNewDraft}
              onSelect={onSelectPrompt}
              onDelete={onDeletePromptRequest}
            />
          </div>
          {charOver ? (
            // 超预算提示行（保存钮稿提示词行实例；warn 持续态——超限即现、降回即消）。
            <span
              role="status"
              className="min-w-[200px] max-w-full truncate text-t-sm text-warn-ink"
            >
              正文超过 32k 字，请精简后保存。
            </span>
          ) : editorFeedback !== null ? (
            editorFeedback.kind === "error" ? (
              // 保存失败（后端真话原文直排；role=alert；持续到下一次操作）。
              <Tip label={editorFeedback.text}>
                <span
                  role="alert"
                  className="min-w-[200px] max-w-full truncate text-t-sm text-bad-ink"
                >
                  {editorFeedback.text}
                </span>
              </Tip>
            ) : (
              // 保存成功「已保存」（三秒自灭由状态层 timer 清除；role=status）。
              <span
                role="status"
                className="min-w-[200px] max-w-full truncate text-t-sm text-ok-ink"
              >
                {editorFeedback.text}
              </span>
            )
          ) : null}
          <span className="flex-1" />
          <Tip label={promptDirty ? "" : "没有未保存的修改"}>
            <Button
              type="button"
              size="sm"
              variant={promptDirty ? "default" : "ghost"}
              disabled={charOver || !promptDirty}
              onClick={onSave}
            >
              保存
            </Button>
          </Tip>
        </div>
        <div className="mt-4">
          <Label htmlFor="prompt-desc" className="mb-2 block">
            描述
          </Label>
          <Input
            id="prompt-desc"
            aria-label="描述"
            placeholder="介绍提示词"
            value={draftDescription}
            onInput={(event) => onDraftDescriptionInput(event.currentTarget.value)}
          />
        </div>
        <div className="mt-4 flex min-h-0 flex-1 flex-col">
          <div className="mb-2 flex items-baseline gap-2">
            <span className="text-t-md font-medium text-foreground">正文</span>
            <span
              className={`text-t-xs font-medium tabular-nums ${charOver ? "text-bad-ink" : "text-muted-foreground"}`}
            >
              {formatChars(bodyChars)} / 32k 字
            </span>
          </div>
          <BodyEditor value={draftBody} onChange={onDraftBodyChange} />
        </div>
      </div>

      <DialogShell
        open={deleteDialogOpen}
        onOpenChange={onDeleteDialogOpenChange}
        title={<>删除提示词「{deleteName}」？</>}
        description="该提示词将被删除；引用它的策略会变为不可用，可重新指定或删除。"
        note="此操作不可撤销"
        flight={deleteBusy}
        closeTip={deleteBusy ? "关闭不等于撤销删除" : ""}
        cancel={{ label: "取消", onClick: () => onDeleteDialogOpenChange(false) }}
        confirm={{
          label: "删除",
          variant: "danger-text",
          onClick: onDeleteConfirm,
        }}
      />
    </section>
  );
}
