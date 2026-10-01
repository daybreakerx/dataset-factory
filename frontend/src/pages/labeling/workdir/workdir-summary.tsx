import { CopyIcon } from "lucide-react";
import { useState } from "react";
import type { components } from "../../../api-types.gen";
import { FormError } from "../../../components/form-error";
import { Button } from "../../../components/ui/button";
import { Tip } from "../../../components/ui/tooltip";
import { formatBytes } from "../../../lib/format";
import type { Batch, Directory } from "./use-workdir-data";

/** 工作目录基本信息区块：路径展示与剪贴板复制、统计行、素材导入入口。 */
export function WorkdirSummary({
  directory,
  batches,
  stats,
  statsError,
  onBrowse,
  onImport,
  onRelocate,
}: {
  directory: Directory;
  batches: Batch[];
  stats: components["schemas"]["WorkdirStatsView"] | null;
  statsError: string;
  onBrowse: () => void;
  onImport: () => void;
  onRelocate: (path: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");

  async function copyPath() {
    setCopyError("");
    setCopied(false);
    try {
      await navigator.clipboard.writeText(directory.path);
      setCopied(true);
    } catch {
      setCopyError("复制失败，请检查浏览器剪贴板权限。");
    }
  }

  return (
    <section
      className="mt-4 rounded-xl border border-border bg-card p-4"
      aria-label="基本信息"
    >
      <h2 className="mb-2 text-t-md font-medium">基本信息</h2>
      <div className="flex flex-wrap items-center gap-3 py-2 text-t-sm">
        <span className="w-[76px] shrink-0 text-text-4">路径</span>
        <span className="min-w-0 flex-1 break-all">{directory.path}</span>
        <Button variant="ghost" size="sm" onClick={onBrowse}>
          打开
        </Button>
        <Tip label="复制路径">
          <Button
            variant="ghost"
            size="sm"
            className="w-(--h-sm) p-0"
            aria-label="复制路径"
            onClick={() => void copyPath()}
          >
            <CopyIcon />
          </Button>
        </Tip>
        {copied && <span role="status">已复制</span>}
        <Button variant="ghost" size="sm" onClick={() => onRelocate("")}>
          修改路径
        </Button>
      </div>
      {copyError && (
        <FormError className="text-t-sm text-bad-ink">{copyError}</FormError>
      )}
      <div className="flex items-center gap-3 py-2 text-t-sm text-text-3">
        <span className="w-[76px] shrink-0 text-text-4">统计</span>
        <span>
          策略 {batches.length}（活跃 {batches.filter((batch) => batch.active).length} ·
          已停用 {batches.filter((batch) => !batch.active).length}）
          {stats && ` · 素材 ${stats.asset_count}`} · 产物{" "}
          {batches.reduce((total, batch) => total + batch.product_count, 0)}
          {stats && ` · ${formatBytes(stats.asset_bytes, "MiB", 2)}`}
        </span>
      </div>
      {statsError && (
        <FormError className="text-t-sm text-bad-ink">{statsError}</FormError>
      )}
      <div className="flex items-center gap-3 py-2 text-t-sm">
        <span className="w-[76px] shrink-0 text-text-4">导入</span>
        <Button variant="ghost" size="sm" onClick={onImport}>
          导入素材
        </Button>
      </div>
    </section>
  );
}
