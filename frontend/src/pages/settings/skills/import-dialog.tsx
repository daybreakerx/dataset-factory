/** 能力 · 技能 · 导入弹窗（拖入 / 文件夹 / SKILL.md / 服务器路径四种方式与反馈条）。 */
import { FileTextIcon, FolderOpenIcon, ImportIcon } from "lucide-react";
import type { ReactElement } from "react";
import { useRef } from "react";
import { DialogShell } from "../../../components/dialog-shell";
import { Alert, AlertDescription } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip";
import type { Feedback } from "../../../lib/feedback";

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

/** 导入弹窗：拖放区触发文件夹选择（webkitdirectory），两种文件选择与服务器路径导入并存。 */
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

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="导入 Skill 包"
      description="agentskills.io 标准"
    >
      <fieldset disabled={importing || readingDrop} className="min-w-0 space-y-3">
        <button
          type="button"
          aria-label="拖入 Skill 包"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            onDrop(event.dataTransfer);
          }}
          onClick={() => fileInputRef.current?.click()}
          className="flex w-full items-center justify-center gap-3 rounded-md border border-dashed border-input bg-card p-8 text-t-md text-muted-foreground"
        >
          <ImportIcon className="size-4" />
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
            disabled={importing}
            onClick={() => fileInputRef.current?.click()}
          >
            <FolderOpenIcon className="size-4" />
            文件夹
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={importing}
            onClick={() => mdInputRef.current?.click()}
          >
            <FileTextIcon className="size-4" />
            SKILL.md 文件
          </Button>
        </div>
        <div className="mt-2 flex gap-2">
          <Input
            aria-label="skill 服务器路径"
            placeholder="服务器上的目录或文件"
            value={pathValue}
            onInput={(event) => onPathInput(event.currentTarget.value)}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                aria-label="选择技能目录或文件"
                disabled={importing}
                onClick={onPickPath}
              >
                <FolderOpenIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>选择目录或文件</TooltipContent>
          </Tooltip>
          <Button
            type="button"
            variant="outline"
            disabled={importing || pathValue.trim() === ""}
            onClick={onImportPath}
          >
            导入
          </Button>
        </div>
        {feedback !== null && (
          <Alert
            variant={feedback.kind === "error" ? "destructive" : "success"}
            className="mt-2"
          >
            <AlertDescription>{feedback.text}</AlertDescription>
          </Alert>
        )}
      </fieldset>
    </DialogShell>
  );
}
