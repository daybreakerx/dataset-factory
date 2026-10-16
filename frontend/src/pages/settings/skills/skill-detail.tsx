/** 能力 · 技能 · 右列详情（头行：名字框＋删除钮＋保存钮；描述、包内容胶囊、内容预览）。 */
import { FileTextIcon, ImageIcon } from "lucide-react";
import type { ReactElement } from "react";
import { useId } from "react";
import type { SkillFileInfo } from "../../../api";
import { TrashIcon } from "../../../components/icons";
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
        // chip 族字色档：普通胶囊 text-2（选中转主色、禁用灰字删除线各归各档）。
        "inline-flex max-w-full items-center gap-1 rounded-full border px-3 py-1 text-t-sm text-text-2 transition-colors [overflow-wrap:anywhere]",
        entry.previewable
          ? "border-border bg-card hover:bg-accent"
          : "cursor-not-allowed border-border bg-muted text-n-400 line-through",
        active &&
          entry.previewable &&
          "border-primary bg-primary/10 text-primary dark:bg-primary/26",
      )}
    >
      {entry.path.startsWith("references/") ? (
        <FileTextIcon className="size-3" />
      ) : entry.path.startsWith("assets/") ? (
        <ImageIcon className="size-3" />
      ) : (
        <FileTextIcon className="size-3" />
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
  /** 名称草稿：null = 未改动（null 化判断在面板回调里）。 */
  nameDraft: string | null;
  /** 名字框显示默认值：健康包 = 显示名；坏包（frontmatter-corrupt）= 抢救值、救不出留空。 */
  nameDefault: string;
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
  /** 描述框显示默认值：健康包 = 落盘描述；坏包 = 抢救值、救不出留空。 */
  descriptionDefault: string;
  onDescriptionChange: (value: string) => void;
  /** 头行消息槽（删除钮右侧、保存钮前；一槽一消息、互斥替换——稿 技能详情头）。
   *  nameBlocked＝消息来自空名拦截：名字框挂 aria-invalid＋aria-describedby 指向槽
   *  （字段级错误程序化关联，design.md 七 9；ok／warn 档不得预设 aria-invalid——ARIA21）。 */
  headNote: {
    kind: "ok" | "warn" | "bad";
    text: string;
    nameBlocked?: boolean;
  } | null;
  onSave: () => void;
  /** 详情头行最左槽：窄屏列表展收的展开钮（面板按窄屏传入；宽屏不传）。 */
  headLeading?: ReactElement;
};

/** 右列：详情头行（可编辑名字框＋删除钮＋保存钮——启停章与底部操作条随两子页归一撤除，
 *  启停只由左列开关表达、放弃路走未保存确认弹窗）＋描述横排字段＋包内容胶囊＋内容预览。 */
export function SkillDetail({
  nameDraft,
  nameDefault,
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
  descriptionDefault,
  onDescriptionChange,
  headNote,
  onSave,
  headLeading,
}: SkillDetailProps): ReactElement {
  // 消息槽 id：空名被拦时名字框经 aria-describedby 程序化关联到它。
  const noteId = useId();
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex min-h-(--h-lg) items-center gap-2">
        {headLeading}
        <input
          aria-label="技能名称"
          aria-invalid={headNote?.nameBlocked || undefined}
          aria-describedby={headNote?.nameBlocked ? noteId : undefined}
          value={nameDraft ?? nameDefault}
          // 飞行期（保存／预览加载）只失效不换装：readonly 掐编辑、外观不动（稿 技能详情头
          // 「保存飞行／预览加载」行；持续禁用才走灰阶——名字框没有持续禁用态）。
          readOnly={saving || loadingPreview || undefined}
          aria-disabled={saving || loadingPreview || undefined}
          onChange={(event) => onNameChange(event.currentTarget.value)}
          className="min-w-24 max-w-[380px] w-fit shrink-[1] basis-auto field-sizing-content -ml-[calc(var(--s-1)+1px)] rounded-md border border-transparent bg-transparent p-1 text-t-xl font-semibold text-foreground hover:border-input focus:border-n-400 focus:outline-none"
        />
        <Tip label="删除技能">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="删除技能"
            // dirty 态删除钮可点（2026-10-01 用户裁「都准备删除了还管什么保存没保存」）——
            // dirty 不再禁删，直接走删除确认弹窗；禁用只留瞬态飞行档。
            disabled={saving || loadingPreview}
            onClick={onDelete}
            // 静止中性、悬停红底红字（.set-head-del 同款，与端点详情头行同构）。
            className="hover:bg-bad-ink/12 hover:text-bad-ink"
          >
            <TrashIcon />
          </Button>
        </Tip>
        {headNote !== null && (
          // 消息槽：12px、单行省略兜底窄窗、被截断时悬停给全文（design.md 六）；
          // 文字用 <span>（带 UA 外边距的标签会把头行撑高）。不带图标（稿 2026-10-01 裁）。
          <span
            id={noteId}
            role="status"
            title={headNote.text}
            className={
              "min-w-0 flex-1 truncate text-t-sm " +
              (headNote.kind === "bad"
                ? "text-bad-ink"
                : headNote.kind === "warn"
                  ? "text-warn-ink"
                  : "text-ok-ink")
            }
          >
            {headNote.text}
          </span>
        )}
        <Tip label={dirty ? "" : "没有未保存的修改"}>
          <Button
            type="button"
            variant={dirty ? "default" : "ghost"}
            className={
              cn(
                headNote === null && "ml-auto",
                // 保存飞行＝瞬态只失效不换装（端点保存钮同款）：不进 disabled 条件、
                // 外观与就绪态同形；重入由面板 savePending／loadingPreview 守卫掐住。
                (saving || loadingPreview) && "pointer-events-none",
              ) || undefined
            }
            disabled={!dirty}
            aria-disabled={saving || loadingPreview || undefined}
            onClick={onSave}
          >
            保存
          </Button>
        </Tip>
      </div>
      <label htmlFor="skill-description" className="flex items-center gap-3 text-t-sm">
        <span className="shrink-0 text-muted-foreground">描述</span>
        <Input
          aria-label="技能描述"
          id="skill-description"
          value={descriptionDraft ?? descriptionDefault}
          // 预览非 SKILL.md＝持续禁用（灰阶，稿样图第 8 格）；保存／加载飞行＝瞬态只失效不换装。
          disabled={previewPath !== "SKILL.md"}
          readOnly={saving || loadingPreview || undefined}
          aria-disabled={saving || loadingPreview || undefined}
          onChange={(event) => onDescriptionChange(event.currentTarget.value)}
        />
      </label>

      <div>
        <div className="flex flex-wrap gap-1">
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
            // 保存飞行／预览加载＝瞬态禁用：只失效不换装——
            // readonly 掐输入且无 UA 灰显，不走 disabled（半透明与灰字都是换装）。
            readOnly={saving || loadingPreview}
            aria-disabled={saving || loadingPreview || undefined}
            onChange={(event) => onPreviewChange(event.currentTarget.value)}
            className="min-h-40 w-full flex-1 resize-none rounded-md border border-input bg-card p-3 font-sans text-t-md leading-(--lh-loose) hover:border-n-400 focus:border-n-400 focus:outline-none"
          />
        </div>
      )}
    </div>
  );
}
