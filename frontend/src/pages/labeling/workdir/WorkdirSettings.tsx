import { ArrowLeftIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../api";
import { DirectoryPicker } from "../../../components/DirectoryPicker";
import { FormError } from "../../../components/form-error";
import { Button } from "../../../components/ui/button";
import { NewStrategyDialog } from "../batching/NewStrategyDialog";
import { SnapshotDialog } from "../batching/SnapshotDialog";
import { CleanupDialog } from "./CleanupDialog";
import { DeleteWorkdirDialog } from "./DeleteWorkdirDialog";
import { ImportMaterialsDialog } from "./ImportMaterialsDialog";
import { RelocateWorkdirDialog } from "./RelocateWorkdirDialog";
import { useWorkdirData } from "./use-workdir-data";
import { WorkdirBatches } from "./workdir-batches";
import { WorkdirCleanup } from "./workdir-cleanup";
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
  const [cleanup, setCleanup] = useState<"products" | "runs" | null>(null);
  const [relocating, setRelocating] = useState<string | null>(null);
  const [cleaningOld, setCleaningOld] = useState<string | null>(null);
  // 飞行态跨块共享：header 刷新钮与策略块的确认交互同守一个 busy。
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false);
  const cleanupPending = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function cleanOld(oldPath: string) {
    if (cleanupPending.current) return;
    cleanupPending.current = true;
    setCleaningOld(oldPath);
    data.setMaintenanceError("");
    try {
      const result = await api.retryRelocationCleanup(wid, oldPath);
      if (!mounted.current) return;
      if (result.cleanup_pending)
        data.setMaintenanceError(`旧位置仍未清理：${result.old_path}`);
      else data.refresh();
    } catch (reason) {
      if (mounted.current) data.setMaintenanceError(errorMessage(reason));
    } finally {
      cleanupPending.current = false;
      if (mounted.current) setCleaningOld(null);
    }
  }

  return (
    <section
      className="h-full overflow-y-auto px-6 pt-4 pb-6"
      aria-label="工作目录设置"
    >
      <header className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeftIcon />
          返回打标页
        </Button>
        <h1 className="text-t-xl font-medium">工作目录设置</h1>
        <Button
          className="ml-auto"
          variant="ghost"
          size="icon"
          aria-label="刷新工作目录"
          disabled={data.loading || busy}
          onClick={data.refresh}
        >
          <RefreshCwIcon />
        </Button>
      </header>
      {data.error && <FormError className="py-3 text-bad-ink">{data.error}</FormError>}
      {data.loading && (
        <p role="status" className="py-3 text-text-3">
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
            onBrowse={() => setBrowse(true)}
            onImport={() => setImporting(true)}
            onRelocate={setRelocating}
          />
          <WorkdirCleanup
            cleanupSummary={data.cleanupSummary}
            summaryError={data.summaryError}
            maintenanceError={data.maintenanceError}
            relocations={data.relocations}
            batches={data.batches}
            cleaningOld={cleaningOld}
            onCleanOld={(oldPath) => void cleanOld(oldPath)}
            onViewCleanup={setCleanup}
            onRelocate={setRelocating}
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
      {!data.loading && data.directory && !data.error && (
        <section
          className="mt-4 rounded-xl border border-border bg-card p-4"
          aria-label="危险操作"
        >
          <h2 className="mb-2 text-t-md font-medium">危险操作</h2>
          <Button
            variant="destructive-soft"
            size="sm"
            onClick={() => setDeleting(true)}
          >
            <Trash2Icon />
            删除工作目录
          </Button>
        </section>
      )}
      {deleting && (
        <DeleteWorkdirDialog
          wid={wid}
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
      {cleanup && (
        <CleanupDialog
          wid={wid}
          kind={cleanup}
          onClose={() => setCleanup(null)}
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
