import { ArrowLeftIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../api";
import type { components } from "../../../api-types.gen";
import { DirectoryPicker } from "../../../components/DirectoryPicker";
import { FormError } from "../../../components/form-error";
import { TrashIcon } from "../../../components/icons";
import { Button } from "../../../components/ui/button";
import { Tip } from "../../../components/ui/tooltip";
import { NewStrategyDialog } from "../batching/NewStrategyDialog";
import { RepointStrategyDialog } from "../batching/RepointStrategyDialog";
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
  // 「重新指定」弹窗（2026-10-13 E4）：新增策略弹窗的引用缺失行点出来的修复出口。
  const [repointing, setRepointing] = useState<
    components["schemas"]["StrategyView"] | null
  >(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [relocating, setRelocating] = useState(false);
  // 清理在飞时关掉弹窗，任务句柄交到这里继续轮询——完成即刷新「清理」行（稿离场口径）。
  const [backgroundCleanup, setBackgroundCleanup] = useState<string | null>(null);
  const refresh = useRef(data.refresh);
  refresh.current = data.refresh;
  // 迁移在飞由弹窗回报：路径行那条链接随它挂 .is-flight（稿格 11）。
  const [relocationRunning, setRelocationRunning] = useState(false);
  // 飞行态跨块共享：策略块的确认交互用它掐自身；头行两钮只随页面级首取禁用，不联动它。
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!backgroundCleanup) return;
    const id = backgroundCleanup;
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const view = await api.getTask(id);
        if (!current) return;
        if (view.status === "running") {
          timer = setTimeout(() => void poll(), 2000);
          return;
        }
        setBackgroundCleanup(null);
        refresh.current();
      } catch {
        if (current) timer = setTimeout(() => void poll(), 2000);
      }
    }
    void poll();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [backgroundCleanup]);

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
            relocations={data.relocations}
            relocationRunning={relocationRunning}
            onBrowse={() => setBrowse(true)}
            onImport={() => setImporting(true)}
            onRelocate={() => setRelocating(true)}
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
          onRepointStrategy={(entry) => {
            setCreating(false);
            setRepointing(entry);
          }}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            data.refresh();
          }}
        />
      )}
      {repointing && (
        <RepointStrategyDialog
          key={repointing.id}
          strategy={repointing}
          onClose={() => setRepointing(null)}
          // 只修引用、不建批次：本页无策略库清单要刷（NewStrategyDialog 每次开窗自拉）。
          onRepointed={() => setRepointing(null)}
        />
      )}
      {relocating && data.directory && (
        <RelocateWorkdirDialog
          wid={wid}
          source={data.directory.path}
          records={data.relocations}
          onClose={() => setRelocating(false)}
          onChanged={data.refresh}
          onRunningChange={setRelocationRunning}
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
          onBackground={setBackgroundCleanup}
        />
      )}
      {importing && data.directory && (
        <ImportMaterialsDialog
          wid={wid}
          workdirPath={data.directory.path}
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
