/** 能力 · 技能 · 导入弹窗（拖入 / 文件夹 / SKILL.md / 服务器路径四种方式与标题行反馈槽）。 */
import { FileTextIcon, FolderOpenIcon, ImportIcon } from "lucide-react";
import type { ReactElement } from "react";
import { useRef } from "react";
import { DialogShell } from "../../../components/dialog-shell";
import { NoteInline } from "../../../components/note-inline";
import { Button } from "../../../components/ui/button";
import { DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip";
import type { Feedback } from "../../../lib/feedback";
import { cn } from "../../../lib/utils";

type ImportDialogProps = {
  open: boolean;
  /** 导入或读取拖入文件中时面板拒绝关闭（守卫在面板回调里）。 */
  onOpenChange: (open: boolean) => void;
  importing: boolean;
  readingDrop: boolean;
  feedback: Feedback | null;
  pathValue: string;
  onPathInput: (value: string) => void;
  /** 打开服务器路径选择器（DirectoryPicker 实例由面板承载）。 */
  onPickPath: () => void;
  onImportFiles: (picked: File[]) => void;
  onImportFile: (picked: File | undefined) => void;
  onImportPath: () => void;
  onDrop: (transfer: DataTransfer) => void;
};

/** 导入弹窗：拖放区触发文件夹选择（webkitdirectory），两种文件选择与服务器路径导入并存。
 *  三态反馈挂弹窗标题行右侧消息槽（成功 ok／警告 warn／失败 bad——稿 导入技能弹窗「反馈槽
 *  形态与落位」行）；头行带三色槽属布局分叉，按壳层约定 children 自组（不走壳层 headNote
 *  槽——它固定红字失败行形态）。 */
export function ImportDialog({
  open,
  onOpenChange,
  importing,
  readingDrop,
  feedback,
  pathValue,
  onPathInput,
  onPickPath,
  onImportFiles,
  onImportFile,
  onImportPath,
  onDrop,
}: ImportDialogProps): ReactElement {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mdInputRef = useRef<HTMLInputElement>(null);
  // 飞行期（导入中／读包中）＝瞬态禁用：只失效不换装（对齐批「瞬态禁用不换装」）。
  // fieldset 层掐指针事件、语义交给 aria-disabled；键盘路径由各控件 onClick 拦截与
  // readOnly 兜底。「导入」钮路径为空是持续禁用，照旧走 disabled 灰阶。
  const flight = importing || readingDrop;
  const flightProps = {
    "aria-disabled": flight || undefined,
    className: flight ? "pointer-events-none" : undefined,
  } as const;

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      className="w-[min(var(--w-modal-560),calc(100vw-48px))]"
    >
      <DialogHeader>
        <div className="flex min-h-(--h-md) items-center gap-3">
          <DialogTitle>导入 Skill 包</DialogTitle>
          {feedback !== null && (
            <NoteInline
              fill
              kind={
                feedback.kind === "error"
                  ? "bad"
                  : feedback.kind === "warn"
                    ? "warn"
                    : "ok"
              }
              role={feedback.kind === "error" ? "alert" : "status"}
              text={feedback.text}
            />
          )}
        </div>
      </DialogHeader>
      <fieldset
        aria-disabled={flight || undefined}
        className={cn("min-w-0 space-y-3", flight && "pointer-events-none")}
      >
        <button
          type="button"
          aria-label="拖入 Skill 包"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            onDrop(event.dataTransfer);
          }}
          onClick={flight ? undefined : () => fileInputRef.current?.click()}
          className={cn(
            "flex w-full items-center justify-center gap-3 rounded-md border border-dashed border-input bg-card p-8 text-t-md text-muted-foreground",
            flight && "pointer-events-none",
          )}
        >
          <ImportIcon className="size-(--icon-md)" />
          拖文件夹 / SKILL.md 到这里导入
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          aria-label="选择 skill 文件夹"
          // @ts-expect-error -- webkitdirectory 为浏览器非标准属性，React DOM 类型未收录
          webkitdirectory=""
          onChange={(event) => {
            const picked = Array.from(event.currentTarget.files ?? []);
            if (picked.length > 0) {
              onImportFiles(picked);
            }
            event.currentTarget.value = "";
          }}
        />
        <input
          ref={mdInputRef}
          type="file"
          accept=".md"
          hidden
          aria-label="选择 SKILL.md 文件"
          onChange={(event) => {
            onImportFile(event.currentTarget.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            {...flightProps}
            onClick={flight ? undefined : () => fileInputRef.current?.click()}
          >
            <FolderOpenIcon className="size-(--icon-md)" />
            文件夹
          </Button>
          <Button
            type="button"
            variant="outline"
            {...flightProps}
            onClick={flight ? undefined : () => mdInputRef.current?.click()}
          >
            <FileTextIcon className="size-(--icon-md)" />
            SKILL.md 文件
          </Button>
        </div>
        <div className="mt-2 flex gap-2">
          <Input
            aria-label="skill 服务器路径"
            placeholder="服务器上的目录或文件"
            value={pathValue}
            readOnly={flight}
            aria-disabled={flight || undefined}
            onInput={(event) => onPathInput(event.currentTarget.value)}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                aria-label="选择技能目录或文件"
                {...flightProps}
                onClick={flight ? undefined : onPickPath}
              >
                <FolderOpenIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>选择目录或文件</TooltipContent>
          </Tooltip>
          <Button
            type="button"
            variant="outline"
            disabled={pathValue.trim() === ""}
            aria-disabled={flight || undefined}
            className={flight ? "pointer-events-none" : undefined}
            onClick={flight ? undefined : onImportPath}
          >
            导入
          </Button>
        </div>
      </fieldset>
    </DialogShell>
  );
}
