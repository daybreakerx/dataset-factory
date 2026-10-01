import type { components } from "../../../api-types.gen";
import { FormError } from "../../../components/form-error";
import { Button } from "../../../components/ui/button";
import { formatBytes } from "../../../lib/format";
import type { Batch } from "./use-workdir-data";

type CleanupSummary = {
  products: components["schemas"]["CleanupPreview"];
  runs: components["schemas"]["RunCleanupEntry"][];
};

function localDate(seconds: number): string {
  const date = new Date(seconds * 1000);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

/** 工作目录清理区块：产物/运行记录清理摘要、搬迁记录与旧位置重试入口。 */
export function WorkdirCleanup({
  cleanupSummary,
  summaryError,
  maintenanceError,
  relocations,
  batches,
  cleaningOld,
  onCleanOld,
  onViewCleanup,
  onRelocate,
}: {
  cleanupSummary: CleanupSummary | null;
  summaryError: string;
  maintenanceError: string;
  relocations: components["schemas"]["WorkdirRelocationStatus"][];
  batches: Batch[];
  cleaningOld: string | null;
  onCleanOld: (oldPath: string) => void;
  onViewCleanup: (kind: "products" | "runs") => void;
  onRelocate: (path: string) => void;
}) {
  const cleanupBatches = new Set(
    cleanupSummary?.products.products.map((entry) => entry.batch),
  );
  const hiddenCleanupBatches = batches.filter(
    (batch) => !batch.active && cleanupBatches.has(batch.seq),
  ).length;
  const runDates = cleanupSummary?.runs.map((entry) => entry.modified_at) ?? [];
  // Q7（2026-09-21 审计）：同一份运行时两端点相同 → 压缩成单日期，跨天才写区间。
  const runDateRange = runDates.length
    ? (() => {
        const min = localDate(Math.min(...runDates));
        const max = localDate(Math.max(...runDates));
        return min === max ? min : `${min} → ${max}`;
      })()
    : "";

  return (
    <section
      className="mt-4 rounded-xl border border-border bg-card p-4"
      aria-label="清理"
    >
      <h2 className="mb-2 text-t-md font-medium">清理</h2>
      {summaryError && (
        <FormError className="text-t-sm text-bad-ink">{summaryError}</FormError>
      )}
      {maintenanceError && (
        <FormError className="break-all text-t-sm text-bad-ink">
          {maintenanceError}
        </FormError>
      )}
      <div className="flex items-center gap-3 py-2 text-t-sm">
        <span className="flex-1">清理无素材产物</span>
        {cleanupSummary && (
          <span className="text-text-3">
            {cleanupSummary.products.products.length} 个 txt（
            {cleanupBatches.size} 套策略，含 {hiddenCleanupBatches} 套已停用）·{" "}
            {formatBytes(cleanupSummary.products.total_bytes, "KiB", 1)}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          aria-label="查看无素材产物清单"
          onClick={() => onViewCleanup("products")}
        >
          查看清单
        </Button>
      </div>
      <div className="flex items-center gap-3 py-2 text-t-sm">
        <span className="flex-1">清理运行记录</span>
        {cleanupSummary && (
          <span className="text-text-3">
            {cleanupSummary.runs.length} 份 ·{" "}
            {formatBytes(
              cleanupSummary.runs.reduce((total, entry) => total + entry.size, 0),
              "KiB",
              1,
            )}
            {runDateRange && ` · ${runDateRange}`}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          aria-label="查看运行记录清单"
          onClick={() => onViewCleanup("runs")}
        >
          查看清单
        </Button>
      </div>
      {relocations.map((record) => (
        <div
          key={record.old_path}
          className="flex flex-wrap items-center gap-3 py-2 text-t-sm"
        >
          <span className="min-w-0 flex-1 break-all">
            {record.status === "cleanup-pending"
              ? `旧位置尚未清理：${record.old_path}`
              : record.status === "copy-retained"
                ? `搬迁副本保留：${record.path}`
                : `工作目录位置已变化：${record.path}`}
          </span>
          {record.status === "cleanup-pending" && (
            <Button
              variant="outline"
              size="sm"
              disabled={cleaningOld !== null}
              onClick={() => onCleanOld(record.old_path)}
            >
              {cleaningOld === record.old_path ? "正在清理" : "重试清理旧位置"}
            </Button>
          )}
          {record.status === "copy-retained" && (
            <Button variant="outline" size="sm" onClick={() => onRelocate(record.path)}>
              重试搬迁
            </Button>
          )}
        </div>
      ))}
    </section>
  );
}
