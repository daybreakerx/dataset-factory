import { ArrowLeftIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { DirectoryPicker } from "../../../components/DirectoryPicker";
import { FormError } from "../../../components/form-error";
import { TrashIcon } from "../../../components/icons";
import { Button } from "../../../components/ui/button";
import { Tip } from "../../../components/ui/tooltip";
import { NewStrategyDialog } from "../batching/NewStrategyDialog";
import { SnapshotDialog } from "../batching/SnapshotDialog";
import { CleanupDialog } from "./CleanupDialog";
import { DeleteWorkdirDialog } from "./DeleteWorkdirDialog";
import { ImportMaterialsDialog } from "./ImportMaterialsDialog";
import { RelocateWorkdirDialog } from "./RelocateWorkdirDialog";
import { useWorkdirData } from "./use-workdir-data";
import { WorkdirBatches } from "./workdir-batches";
import { WorkdirSummary } from "./workdir-summary";

export function WorkdirSettings({
  wid,
  onBack,
  onChanged,
  onDeleted,
}: {
  wid: string;
  onBack: () => void;
  onChanged: () => void;
  onDeleted?: () => void;
}) {
  const data = useWorkdirData(wid, onChanged);
  const [browse, setBrowse] = useState(false);
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [relocating, setRelocating] = useState<string | null>(null);
  // 飞行态跨块共享：策略块的确认交互用它掐自身；头行两钮只随页面级首取禁用，不联动它。
  const [busy, setBusy] = useState(false);

  return (
    <section
      className="h-full overflow-y-auto px-6 pt-4 pb-6"
      aria-label="工作目录设置"
    >
      <header className="flex items-center gap-3">
        <Button variant="ghost" size="lg" onClick={onBack}>
          <ArrowLeftIcon />
          返回主页面
        </Button>
        <h1 className="text-t-xl font-medium">工作目录设置</h1>
        <Tip label="删除工作目录">
          <Button
            // 行 gap 12，回拉 8 得稿定的 4px 题钮间距（base.css §31 .wd-del 同款）。
            className="-ml-2 hover:bg-bad-ink/12 hover:text-bad-ink"
            variant="ghost"
            size="icon-sm"
            aria-label="删除工作目录"
            disabled={data.loading}
            onClick={() => setDeleting(true)}
          >
            <TrashIcon />
          </Button>
        </Tip>
        <Tip label="刷新">
          <Button
            className="ml-auto"
            variant="ghost"
            size="icon-lg"
            aria-label="刷新工作目录"
            data-loading={data.refreshing || undefined}
            disabled={data.loading}
            onClick={data.refresh}
          >
            <RefreshCwIcon />
          </Button>
        </Tip>
      </header>
      {data.error && (
        <FormError className="py-3 text-t-sm text-bad-ink">
          工作目录读取失败：{data.error}
        </FormError>
      )}
      {data.loading && (
        <p role="status" className="py-3 text-t-sm text-text-3">
          正在读取工作目录
        </p>
      )}
      {!data.loading && data.directory && !data.error && (
        <>
          <WorkdirSummary
            directory={data.directory}
            batches={data.batches}
            stats={data.stats}
            statsError={data.statsError}
            cleanupSummary={data.cleanupSummary}
            summaryError={data.summaryError}
            onBrowse={() => setBrowse(true)}
            onImport={() => setImporting(true)}
            onRelocate={setRelocating}
            onViewCleanup={() => setCleanupOpen(true)}
          />
          <WorkdirBatches
            wid={wid}
            batches={data.batches}
            stats={data.stats}
            runStates={data.runStates}
            runError={data.runError}
            busy={busy}
            setBusy={setBusy}
            onRefresh={data.refresh}
            onCreate={() => setCreating(true)}
            onSnapshot={setSnapshot}
          />
        </>
      )}
      {deleting && data.directory && (
        <DeleteWorkdirDialog
          wid={wid}
          name={data.directory.title}
          onClose={() => setDeleting(false)}
          onDeleted={() => {
            setDeleting(false);
            if (onDeleted) onDeleted();
            else {
              onChanged();
              onBack();
            }
          }}
        />
      )}
      {creating && data.directory && (
        <NewStrategyDialog
          wid={wid}
          title={data.directory.title}
          nextSeq={
            data.batches.length
              ? Math.max(...data.batches.map((entry) => entry.seq)) + 1
              : 1
          }
          existingCount={data.batches.length}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            data.refresh();
          }}
        />
      )}
      {relocating !== null && data.directory && (
        <RelocateWorkdirDialog
          wid={wid}
          source={data.directory.path}
          initialTarget={relocating}
          onClose={() => setRelocating(null)}
          onChanged={data.refresh}
        />
      )}
      {browse && data.directory && (
        <DirectoryPicker
          initialPath={data.directory.path}
          browseOnly
          onClose={() => setBrowse(false)}
          onSelect={() => {}}
        />
      )}
      {cleanupOpen && (
        <CleanupDialog
          wid={wid}
          onClose={() => setCleanupOpen(false)}
          onCleaned={data.refresh}
        />
      )}
      {importing && (
        <ImportMaterialsDialog
          wid={wid}
          onClose={() => setImporting(false)}
          onImported={data.refresh}
        />
      )}
      {snapshot && (
        <SnapshotDialog wid={wid} batch={snapshot} onClose={() => setSnapshot(null)} />
      )}
    </section>
  );
}
