/** 能力 · 技能 · 右列详情（名字框、描述、包内容胶囊、内容预览、放弃/保存）。 */
import {
  CopyIcon,
  FileTextIcon,
  ImageIcon,
  SaveIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";
import type { ReactElement } from "react";
import type { SkillFileInfo, SkillInfo } from "../../../api";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import {
  Tip,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";

function SkillFileChip({
  entry,
  active,
  disabled,
  onSelect,
}: {
  entry: SkillFileInfo;
  active: boolean;
  disabled: boolean;
  onSelect: (path: string) => void;
}): ReactElement {
  const chip = (
    <button
      type="button"
      disabled={disabled || !entry.previewable}
      onClick={() => onSelect(entry.path)}
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border px-3 py-1 text-t-sm transition-colors [overflow-wrap:anywhere]",
        entry.previewable
          ? "border-border bg-card hover:bg-accent"
          : "cursor-not-allowed border-border bg-muted text-n-400 line-through",
        active && entry.previewable && "border-primary bg-primary/10 text-primary",
      )}
    >
      {entry.path.startsWith("references/") ? (
        <FileTextIcon className="size-3" />
      ) : entry.path.startsWith("assets/") ? (
        <ImageIcon className="size-3" />
      ) : (
        <CopyIcon className="size-3" />
      )}
      {entry.path}
    </button>
  );
  if (entry.previewable) {
    return chip;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{chip}</span>
      </TooltipTrigger>
      <TooltipContent>不参与注入（注入范围 = SKILL.md 与 references/）</TooltipContent>
    </Tooltip>
  );
}

type SkillDetailProps = {
  current: SkillInfo;
  /** 名称草稿：null = 未改动（null 化判断在面板回调里）。 */
  nameDraft: string | null;
  onNameChange: (value: string) => void;
  saving: boolean;
  loadingPreview: boolean;
  dirty: boolean;
  onDelete: () => void;
  files: SkillFileInfo[];
  previewPath: string;
  onOpenPreview: (path: string) => void;
  previewContent: string;
  onPreviewChange: (value: string) => void;
  /** 描述草稿：null = 未改动（null 化判断在面板回调里）。 */
  descriptionDraft: string | null;
  onDescriptionChange: (value: string) => void;
  onRevert: () => void;
  onSave: () => void;
};

/** 右列：可编辑名字框与描述、包内容胶囊行、内容预览与放弃/保存钮。 */
export function SkillDetail({
  current,
  nameDraft,
  onNameChange,
  saving,
  loadingPreview,
  dirty,
  onDelete,
  files,
  previewPath,
  onOpenPreview,
  previewContent,
  onPreviewChange,
  descriptionDraft,
  onDescriptionChange,
  onRevert,
  onSave,
}: SkillDetailProps): ReactElement {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-2">
        <input
          aria-label="技能名称"
          value={nameDraft ?? current.name}
          disabled={saving || loadingPreview}
          onChange={(event) => onNameChange(event.currentTarget.value)}
          className="min-w-15 max-w-105 field-sizing-content rounded-md border border-transparent bg-transparent px-1 py-0.5 text-t-xl font-medium hover:border-border hover:bg-card focus:border-input"
        />
        <Badge variant={current.enabled ? "success" : "muted"}>
          {current.enabled ? "已启用" : "已停用"}
        </Badge>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="删除技能"
              className="ml-auto"
              disabled={dirty || saving || loadingPreview}
              onClick={onDelete}
            >
              <Trash2Icon className="text-bad-ink" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>删除技能</TooltipContent>
        </Tooltip>
      </div>
      <label htmlFor="skill-description" className="flex items-center gap-3 text-t-sm">
        <span className="shrink-0 text-muted-foreground">描述</span>
        <Input
          aria-label="技能描述"
          id="skill-description"
          value={descriptionDraft ?? current.description}
          disabled={saving || loadingPreview || previewPath !== "SKILL.md"}
          onChange={(event) => onDescriptionChange(event.currentTarget.value)}
        />
      </label>

      <div>
        <div className="flex flex-wrap gap-1.5">
          {files.map((entry) => (
            <SkillFileChip
              key={entry.path}
              entry={entry}
              active={entry.path === previewPath}
              disabled={dirty || saving}
              onSelect={onOpenPreview}
            />
          ))}
        </div>
      </div>

      {previewPath !== "" && (
        <div className="flex min-h-40 flex-1 flex-col gap-2">
          <label htmlFor="skill-content" className="text-t-sm text-muted-foreground">
            内容预览
          </label>
          <textarea
            aria-label="技能文件内容"
            id="skill-content"
            spellCheck={false}
            value={previewContent}
            disabled={saving || loadingPreview}
            onChange={(event) => onPreviewChange(event.currentTarget.value)}
            className="min-h-40 w-full flex-1 resize-y rounded-md border border-input bg-card px-4 py-3 font-sans text-t-sm leading-(--lh-loose) hover:border-n-400 focus:border-n-400"
          />
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={!dirty || saving} onClick={onRevert}>
          <Undo2Icon />
          放弃更改
        </Button>
        <Tip label={dirty ? "" : "没有未保存的修改"}>
          <Button
            variant={dirty ? "default" : "ghost"}
            disabled={!dirty || saving || loadingPreview}
            onClick={onSave}
          >
            <SaveIcon />
            保存更改
          </Button>
        </Tip>
      </div>
    </div>
  );
}
