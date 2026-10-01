/** 提示词编辑列（区块组件）：名称与提示词库、描述、正文与字节护栏、反馈与删除确认。 */
import { ChevronDownIcon, PlusIcon, Trash2Icon } from "lucide-react";
import type { ReactElement } from "react";
import type { PromptInfo } from "../../../api";
import { DialogShell } from "../../../components/dialog-shell";
import { Alert, AlertDescription } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import {
  Tip,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip";
import type { Feedback } from "../../../lib/feedback";
import { formatBytes } from "../../../lib/format";
import { BodyEditor } from "./BodyEditor";

/** 基础提示词的字节护栏（对齐 Codex project_doc_max_bytes，后端同值校验）。 */
const PROMPT_BYTE_BUDGET = 32 * 1024;

/** 提示词库下拉弹层（本列私有件）：切换触发件＋库列表＋新建入口。 */
function PromptMenu({
  open,
  onOpenChange,
  prompts,
  promptDirty,
  onNew,
  onSelect,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompts: PromptInfo[];
  promptDirty: boolean;
  onNew: () => void;
  onSelect: (name: string) => void;
  onDelete: (name: string) => void;
}): ReactElement {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-0 size-6"
          aria-label="切换提示词"
          disabled={promptDirty}
        >
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 max-w-[calc(100vw-32px)]">
        <div className="flex items-center justify-between px-2 py-1 text-t-xs text-text-4">
          <span>提示词库 · 共 {prompts.length} 条</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="新建提示词"
                onClick={onNew}
              >
                <PlusIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>新建提示词</TooltipContent>
          </Tooltip>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {prompts.map((prompt) => (
            <div
              key={prompt.name}
              className="flex items-center gap-1 rounded-md p-2 hover:bg-accent"
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                aria-label={`选择提示词 ${prompt.name}`}
                onClick={() => onSelect(prompt.name)}
              >
                <span className="block truncate text-t-md font-medium">
                  {prompt.name}
                </span>
                <span className="block truncate text-t-xs text-n-500">
                  {prompt.description}
                </span>
              </button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-bad-ink"
                    aria-label={`删除提示词 ${prompt.name}`}
                    onClick={() => onDelete(prompt.name)}
                  >
                    <Trash2Icon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>删除</TooltipContent>
              </Tooltip>
            </div>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function EditorColumn({
  prompts,
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
  onDeleteConfirm,
}: {
  prompts: PromptInfo[];
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
  onDeleteConfirm: () => void;
}): ReactElement {
  const bodyBytes = new TextEncoder().encode(draftBody).length;
  const byteOver = bodyBytes > PROMPT_BYTE_BUDGET;
  const bodySize = formatBytes(bodyBytes, "KiB", 1);

  return (
    <section
      className="flex min-h-80 min-w-0 flex-col px-6 py-4 lg:min-h-0"
      aria-label="提示词编辑列"
    >
      <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border bg-card px-6 py-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-t-sm text-text-3">提示词</span>
          <div className="relative flex min-w-0 max-w-full items-center">
            <input
              id="prompt-name"
              aria-label="名称"
              value={draftName}
              placeholder="新建提示词"
              className="min-w-24 max-w-full field-sizing-content rounded-md border border-transparent bg-transparent py-1 pr-7 pl-1 text-t-xl font-medium hover:border-input focus:border-n-400"
              onInput={(event) => onDraftNameInput(event.currentTarget.value)}
            />
            <PromptMenu
              open={promptMenuOpen}
              onOpenChange={onPromptMenuOpenChange}
              prompts={prompts}
              promptDirty={promptDirty}
              onNew={onNewDraft}
              onSelect={onSelectPrompt}
              onDelete={onDeletePromptRequest}
            />
          </div>
          <span className="flex-1" />
          <Tip label={promptDirty ? "" : "没有未保存的修改"}>
            <Button
              type="button"
              size="sm"
              variant={promptDirty ? "default" : "ghost"}
              disabled={byteOver || !promptDirty}
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
            value={draftDescription}
            onInput={(event) => onDraftDescriptionInput(event.currentTarget.value)}
          />
        </div>
        <div className="mt-4 flex min-h-0 flex-1 flex-col">
          <div className="mb-2 flex items-baseline gap-2">
            <span className="text-t-md font-medium text-foreground">正文</span>
            <span
              className={`text-t-xs font-medium tabular-nums ${byteOver ? "text-bad-ink" : "text-muted-foreground"}`}
            >
              {bodySize} / 32 KiB
            </span>
          </div>
          <BodyEditor value={draftBody} onChange={onDraftBodyChange} />
        </div>
      </div>

      {editorFeedback !== null && (
        <Alert
          variant={editorFeedback.kind === "error" ? "destructive" : "success"}
          className="mt-3"
        >
          <AlertDescription>{editorFeedback.text}</AlertDescription>
        </Alert>
      )}

      <DialogShell
        open={deleteDialogOpen}
        onOpenChange={onDeleteDialogOpenChange}
        title={<>删除提示词「{deleteName}」？</>}
        description="将连同其历史备份一起移除。此操作不可撤销。"
        cancel={{ label: "取消", onClick: () => onDeleteDialogOpenChange(false) }}
        confirm={{
          label: "删除",
          variant: "destructive-fill",
          onClick: onDeleteConfirm,
        }}
      />
    </section>
  );
}
