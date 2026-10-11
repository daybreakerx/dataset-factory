import { CopyIcon, XIcon } from "lucide-react";
import { useState } from "react";
import type { components } from "../../../api-types.gen";
import { FormError } from "../../../components/form-error";
import { HScroll } from "../../../components/hs-scroll";
import { Button } from "../../../components/ui/button";
import { Tip } from "../../../components/ui/tooltip";
import { formatBytes } from "../../../lib/format";
import type { Batch, Directory } from "./use-workdir-data";

/** 设置行族的标签列（稿 base.css §31 `.wd-slabel`）：弹性宽——宽屏锁 76（第二列左缘 88 不动）、窄屏渐收到内容宽。 */
const labelClass = "w-[min(76px,10%)] min-w-max shrink-0 text-text-3";
const rowClass = "flex items-center gap-3 py-2 text-t-sm";

/** 工作目录基本信息区块：路径行（单行横滚＋动作）、统计行、导入行、清理行。 */
export function WorkdirSummary({
  directory,
  batches,
  stats,
  statsError,
  cleanupSummary,
  summaryError,
  onBrowse,
  onImport,
  onRelocate,
  onViewCleanup,
}: {
  directory: Directory;
  batches: Batch[];
  stats: components["schemas"]["WorkdirStatsView"] | null;
  statsError: string;
  cleanupSummary: components["schemas"]["CleanupPreview"] | null;
  summaryError: string;
  onBrowse: () => void;
  onImport: () => void;
  onRelocate: (path: string) => void;
  onViewCleanup: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  async function copyPath() {
    setCopyFailed(false);
    setCopied(false);
    try {
      await navigator.clipboard.writeText(directory.path);
      setCopied(true);
    } catch {
      setCopyFailed(true);
    }
  }

  const cleanupBatches = new Set(cleanupSummary?.products.map((entry) => entry.batch));
  const hiddenCleanupBatches = batches.filter(
    (batch) => !batch.active && cleanupBatches.has(batch.seq),
  ).length;

  return (
    <section
      className="mt-4 rounded-xl border border-border bg-card p-4"
      aria-label="基本信息"
    >
      <h2 className="mb-2 text-t-md font-medium">基本信息</h2>
      <div className={rowClass}>
        <span className={labelClass}>路径</span>
        {/* 值单行横滚（格 7 裁「禁折行改单行横滚」）：超长走值内滚动，行不折、动作位不动。 */}
        <HScroll className="min-w-0 flex-1">
          <span className="whitespace-nowrap text-text-2">{directory.path}</span>
        </HScroll>
        <Button variant="ghost" size="sm" onClick={onBrowse}>
          打开
        </Button>
        <Tip label={copyFailed ? "复制失败，请检查剪贴板权限" : "复制路径"}>
          <Button
            variant="ghost"
            size="icon-sm"
            className={copyFailed ? "text-bad-ink" : undefined}
            aria-label="复制路径"
            onClick={() => void copyPath()}
          >
            {copyFailed ? <XIcon /> : <CopyIcon />}
          </Button>
        </Tip>
        {copied && <span role="status">已复制</span>}
        <Tip label="选一个目标目录，整个工作目录会搬过去">
          <Button variant="ghost" size="sm" onClick={() => onRelocate("")}>
            修改路径
          </Button>
        </Tip>
      </div>
      <div className={rowClass}>
        <span className={labelClass}>统计</span>
        <span className="min-w-0 flex-1 text-text-2">
          策略 {batches.length}（活跃 {batches.filter((batch) => batch.active).length} ·
          已停用 {batches.filter((batch) => !batch.active).length}）
          {stats && ` · 素材 ${stats.asset_count}`} · 产物{" "}
          {batches.reduce((total, batch) => total + batch.product_count, 0)}
          {stats && ` · ${formatBytes(stats.asset_bytes, "MB", 2)}`}
        </span>
        {/* 失败红字行内缀在值右侧（格 9 裁）：固定句＝本地因果直说，后端那句「无法读取完整素材统计…」不上界面。 */}
        {statsError && (
          <span role="alert" className="ml-2 whitespace-nowrap text-bad-ink">
            素材统计失败，目录在读取时被占用
          </span>
        )}
      </div>
      <div className={rowClass}>
        <span className={labelClass}>导入</span>
        <span className="min-w-0 flex-1 text-text-3">导入新素材</span>
        <Button variant="ghost" size="sm" onClick={onImport}>
          导入素材
        </Button>
      </div>
      <div className={rowClass}>
        <span className={labelClass}>清理</span>
        {/* 取数未回＝第二列静默缺席（F5 收口），动作列照常钉行尾。 */}
        <span className="min-w-0 flex-1 text-text-2">
          {cleanupSummary && (
            <>
              无素材产物：
              <span className="tabular-nums">
                {cleanupSummary.products.length} 个 txt（{cleanupBatches.size}{" "}
                套策略，含 {hiddenCleanupBatches} 套已停用）·{" "}
                {formatBytes(cleanupSummary.total_bytes, "KB", 1)}
              </span>
            </>
          )}
        </span>
        <Button variant="ghost" size="sm" onClick={onViewCleanup}>
          查看清单
        </Button>
      </div>
      {summaryError && (
        <FormError className="text-t-sm text-bad-ink">{summaryError}</FormError>
      )}
    </section>
  );
}
