import { FolderIcon } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Tip } from "../../../components/ui/tooltip";

/** 新建跑批·素材来源段：复制/就地两种模式卡、来源与工作目录输入、就地采用确认。 */
export function BatchSourceFields({
  id,
  mode,
  source,
  path,
  acknowledged,
  disabled,
  onModeChange,
  onSourceChange,
  onPathChange,
  onAcknowledgeChange,
  onPickDirectory,
}: {
  id: string;
  mode: "copy" | "inplace";
  source: string;
  path: string;
  acknowledged: boolean;
  disabled: boolean;
  onModeChange: (mode: "copy" | "inplace") => void;
  onSourceChange: (value: string) => void;
  onPathChange: (value: string) => void;
  onAcknowledgeChange: (checked: boolean) => void;
  onPickDirectory: (field: "source" | "path") => void;
}) {
  return (
    <fieldset disabled={disabled} className="space-y-4">
      <legend className="mb-3 text-t-sm text-muted-foreground">素材来源</legend>
      {/* 来源两张卡带副说明——「复制 / 就地」各自意味着什么，选择前读得到。 */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label
          className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${mode === "copy" ? "border-primary/50 bg-primary/5" : "border-border bg-card"}`}
        >
          <input
            type="radio"
            name={`${id}-mode`}
            className="mt-1"
            checked={mode === "copy"}
            onChange={() => onModeChange("copy")}
          />
          <span>
            <span className="block text-t-md font-medium">复制导入</span>
            <span className="mt-1 block text-t-xs text-muted-foreground">
              把素材复制进独立的工作目录，源目录保持原样（推荐——试标、重跑互不干扰）。
            </span>
          </span>
        </label>
        <label
          className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${mode === "inplace" ? "border-primary/50 bg-primary/5" : "border-border bg-card"}`}
        >
          <input
            type="radio"
            name={`${id}-mode`}
            className="mt-1"
            checked={mode === "inplace"}
            onChange={() => onModeChange("inplace")}
          />
          <span>
            <span className="block text-t-md font-medium">就地采用</span>
            <span className="mt-1 block text-t-xs text-muted-foreground">
              直接把素材目录登记为工作目录——.dsf 与产物 txt 会写进这个目录。
            </span>
          </span>
        </label>
      </div>
      {mode === "copy" && (
        <div className="space-y-2">
          <label htmlFor={`${id}-source`}>来源目录</label>
          <div className="flex items-center gap-2">
            <Input
              id={`${id}-source`}
              value={source}
              onChange={(event) => onSourceChange(event.currentTarget.value)}
            />
            <Tip label="选择来源目录">
              <Button
                type="button"
                variant="outline"
                size="icon-lg"
                aria-label="选择来源目录"
                onClick={() => onPickDirectory("source")}
              >
                <FolderIcon />
              </Button>
            </Tip>
          </div>
        </div>
      )}
      <div className="space-y-2">
        <label htmlFor={`${id}-path`}>工作目录</label>
        <div className="flex items-center gap-2">
          <Input
            id={`${id}-path`}
            value={path}
            onChange={(event) => onPathChange(event.currentTarget.value)}
          />
          <Tip label="选择工作目录">
            <Button
              type="button"
              variant="outline"
              size="icon-lg"
              aria-label="选择工作目录"
              onClick={() => onPickDirectory("path")}
            >
              <FolderIcon />
            </Button>
          </Tip>
        </div>
      </div>
      {mode === "inplace" && (
        <label className="flex items-start gap-2 rounded-md border border-warn-bd bg-warn-bg p-3 text-t-sm text-warn-ink">
          <input
            type="checkbox"
            className="cb mt-1"
            checked={acknowledged}
            onChange={(event) => onAcknowledgeChange(event.currentTarget.checked)}
          />
          确认就地采用：工具将写入 .dsf 与产物 txt，删除工作目录会连素材一起删除。
        </label>
      )}
    </fieldset>
  );
}
