import { FileIcon, FileImageIcon, FilmIcon, XIcon } from "lucide-react";
import { memo } from "react";
import { TrashIcon } from "../../../components/icons";
import { Button } from "../../../components/ui/button";
import { Tip } from "../../../components/ui/tooltip";
import { formatBytesAuto } from "../../../lib/format";
import { exclusionLabel } from "../material-actions";
import type { ItemRow } from "../runs/items-state";

export const MaterialRow = memo(function MaterialRow({
  row,
  selected,
  onSelect,
  selectionMode,
  checked,
  onCheck,
  retryGroup,
  saving,
  onRemoveRetry,
  onRecover,
  onRepoint,
  onRemoveUnimported,
}: {
  row: ItemRow;
  selected: boolean;
  onSelect: (row: ItemRow) => void;
  selectionMode: boolean;
  checked: boolean;
  onCheck: (item: string) => void;
  retryGroup: boolean;
  saving: boolean;
  onRemoveRetry: (item: string) => void;
  onRecover: (row: ItemRow) => void;
  /** 缺失行「重新指定」：来源已失效，开目录选择弹窗选定新来源。 */
  onRepoint: (name: string) => void;
  onRemoveUnimported: (row: ItemRow) => void;
}) {
  return (
    <div className="group flex items-center gap-2 rounded-md px-2 hover:bg-accent">
      {selectionMode &&
        !retryGroup &&
        (row.status === "done" || row.status === "failed") && (
          <input
            type="checkbox"
            className="cb"
            aria-label={`选择 ${row.name}`}
            checked={checked}
            disabled={!row.can_retry || row.in_retry || saving}
            onChange={() => onCheck(row.item)}
          />
        )}
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(row)}
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-md py-2 text-left text-t-md ${selected ? "bg-primary/10 dark:bg-primary/26" : ""} ${row.status === "missing" ? "opacity-[0.62]" : ""}`}
      >
        <span className="flex h-[27px] w-9 shrink-0 items-center justify-center rounded-sm border border-border bg-muted/60 text-text-3">
          {row.media === "video" ? (
            <FilmIcon className="size-(--icon-sm)" />
          ) : row.media === "image" ? (
            <FileImageIcon className="size-(--icon-sm)" />
          ) : (
            <FileIcon className="size-(--icon-sm)" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <Tip label={row.name}>
            <span className="block truncate">{row.name}</span>
          </Tip>
          {(row.message || row.reason) && (
            <span className="block break-words text-t-xs text-text-3">
              {row.message || exclusionLabel(row.reason)}
              {/* V2（2026-09-21 审计）：契约里一直带着 size / limit——超出大小上限
                  这类拒绝要让用户看到具体数值（原型口径：412 MB ＞ 100 MB）。 */}
              {row.status === "unimported" &&
                row.size !== null &&
                row.size !== undefined &&
                row.limit !== null &&
                row.limit !== undefined &&
                ` · ${formatBytesAuto(row.size)} ＞ ${formatBytesAuto(row.limit)}`}
            </span>
          )}
          {row.in_retry && (
            <span className="text-t-xs text-muted-foreground">已排重试</span>
          )}
          {row.status === "missing" && !row.recoverable && (
            <span className="block text-t-xs text-text-3">原始来源不可用</span>
          )}
        </span>
      </button>
      {row.status === "missing" && (
        <Tip label={row.recoverable ? `来源：${row.source}` : "来源已失效，请重新指定"}>
          <Button
            variant="ghost"
            size="mini"
            className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
            onClick={() => (row.recoverable ? onRecover(row) : onRepoint(row.name))}
          >
            {row.recoverable ? "重新导入" : "重新指定"}
          </Button>
        </Tip>
      )}
      {row.status === "unimported" && (
        <Tip
          label={row.reason === "未登记" ? "导入此文件" : (row.reason ?? "不能导入")}
        >
          <Button
            variant="ghost"
            size="mini"
            disabled={row.reason !== "未登记"}
            onClick={() => onRecover(row)}
          >
            导入
          </Button>
        </Tip>
      )}
      {retryGroup && (
        <Tip label="移出重试列表">
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={saving}
            aria-label={`移出重试 ${row.name}`}
            onClick={() => onRemoveRetry(row.item)}
          >
            <XIcon />
          </Button>
        </Tip>
      )}
      {row.status === "unimported" && (
        <Tip label="删除">
          <Button
            variant="destructive"
            size="icon-xs"
            className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
            aria-label={`删除未导入 ${row.name}`}
            onClick={() => onRemoveUnimported(row)}
          >
            <TrashIcon />
          </Button>
        </Tip>
      )}
    </div>
  );
});
