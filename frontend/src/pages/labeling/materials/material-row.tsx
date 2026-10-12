import { FileIcon, FileImageIcon, FilmIcon, ImportIcon, XIcon } from "lucide-react";
import { memo } from "react";
import { TrashIcon } from "../../../components/icons";
import { Button } from "../../../components/ui/button";
import { Tip } from "../../../components/ui/tooltip";
import { formatBytesAuto } from "../../../lib/format";
import { exclusionLabel } from "../material-actions";
import type { ItemRow } from "../runs/items-state";

/** 动作一律悬停显形（§10 .row-act--reveal）：未悬停 opacity 0、占位照留，键盘到位同样显形。 */
const reveal =
  "opacity-0 transition-opacity duration-(--dur-1) group-hover:opacity-100 group-focus-within:opacity-100";

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
  // 行盒＝§34 .lb-itrow：1px 描边槽常驻（透明），选中显色时行盒不跳；纵向内距随之减 1 补偿。
  // 选中＝弹层当前行同款三件套（ tint ＋ 描边 ＋ 名字转主色），悬停不换装。
  const shell = selected
    ? "border-primary/30 bg-primary/8 dark:bg-primary/22 hover:bg-primary/8 dark:hover:bg-primary/22"
    : "hover:bg-accent";

  return (
    <div
      className={`group flex items-center gap-2 rounded-md border border-transparent px-2 py-[7px] ${shell}`}
    >
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
        className={`flex min-w-0 flex-1 items-center gap-2 text-left ${row.status === "missing" ? "opacity-[0.62]" : ""}`}
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
          {/* 名字带序号，数字等宽才纵向扫得齐（§34 .lb-itrow .row-name）。 */}
          <Tip label={row.name}>
            <span
              className={`block truncate text-t-md leading-(--lh-base) tabular-nums ${
                selected ? "text-primary" : "text-text-1"
              }`}
            >
              {row.name}
            </span>
          </Tip>
          {(row.message || row.reason) && (
            <span className="block break-words text-t-xs leading-(--lh-base) text-muted-foreground">
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
          {/* 「重打」浅底章（§34 .lb-itreplay）：重试列表那一份不挂——整组都是重打条目，逐行再挂＝标记变底色。 */}
          {row.in_retry && !retryGroup && (
            <span className="inline-flex h-[18px] items-center rounded-full border border-warn-bd bg-warn-bg px-2 text-t-xs font-medium leading-none text-warn-ink">
              重打
            </span>
          )}
        </span>
      </button>
      {row.status === "missing" && (
        <Tip label={row.recoverable ? `来源：${row.source}` : "来源已失效，请重新指定"}>
          <Button
            variant="ghost"
            size="sm"
            className={reveal}
            onClick={() => (row.recoverable ? onRecover(row) : onRepoint(row.name))}
          >
            {row.recoverable ? "重新导入" : "重新指定"}
          </Button>
        </Tip>
      )}
      {row.status === "unimported" && (
        // 「导入」＝纯图标钮（稿裁：文字进 aria-label、不挂 Tip——与行内原因行重复）。
        <Button
          variant="ghost"
          size="icon-sm"
          className={reveal}
          disabled={row.reason !== "未登记"}
          aria-label={`导入 ${row.name}`}
          onClick={() => onRecover(row)}
        >
          <ImportIcon />
        </Button>
      )}
      {retryGroup && (
        <Button
          variant="ghost"
          size="icon-sm"
          className={reveal}
          disabled={saving}
          aria-label={`移出重试 ${row.name}`}
          onClick={() => onRemoveRetry(row.item)}
        >
          <XIcon />
        </Button>
      )}
      {row.status === "unimported" && (
        // 危险图标钮（base.css §7「危险图标钮」＝.btn--ghost.btn--icon.danger）：
        // 静止中性灰、悬停才显红（字 --bad-ink ＋ 底 --bad-ink/.12），红不常驻。
        <Button
          variant="ghost"
          size="icon-sm"
          className={`${reveal} hover:bg-bad-ink/12 hover:text-bad-ink`}
          aria-label={`删除未导入 ${row.name}`}
          onClick={() => onRemoveUnimported(row)}
        >
          <TrashIcon />
        </Button>
      )}
    </div>
  );
});
