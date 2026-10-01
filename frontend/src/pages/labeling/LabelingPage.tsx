import { FileImageIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../api";
import { FormError } from "../../components/form-error";
import { Button } from "../../components/ui/button";
import {
  LABELING_SELECTED_ITEM_KEY,
  readStoredString,
  writeStoredJson,
} from "../../lib/ui-storage";
import { BatchConfiguration } from "./batching/BatchConfiguration";
import { BatchSelector } from "./batching/BatchSelector";
import { NewBatchForm } from "./batching/NewBatchForm";
import { NewStrategyDialog } from "./batching/NewStrategyDialog";
import { useBatchRunState } from "./hooks/use-batch-run-state";
import { loadWorkdirBatches, useWorkdirBatches } from "./hooks/use-workdir-batches";
import { MaterialDetail } from "./materials/material-detail";
import { MaterialsPanel, type RecoveryRequest } from "./materials/materials-panel";
import { BatchOverview } from "./runs/BatchOverview";
import {
  type ItemMap,
  type ItemRow,
  itemKey,
  itemsFromGroups,
  withItemUpdate,
  withRetryItems,
} from "./runs/items-state";
import { RunControl } from "./runs/RunControl";
import { ImportMaterialsDialog } from "./workdir/ImportMaterialsDialog";
import { RemoveUnimportedDialog } from "./workdir/RemoveUnimportedDialog";
import { WorkdirSettings } from "./workdir/WorkdirSettings";

/** 目录与批次切换以成对身份取数，过期请求不能覆盖新选择。 */
export function LabelingPage({
  onNavigateToSettings,
  onOpenWorkbench,
}: {
  /** 跳应用级设置页（V16：新建跑批的三个下拉要有「去设置」的出口）。 */
  onNavigateToSettings?: () => void;
  /** 跳对话工作台（V16：「拿不准效果？先试标」动线）。 */
  onOpenWorkbench?: () => void;
} = {}) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const { workdirs, setWorkdirs, selection, setSelection, setDirectoriesRevision } =
    useWorkdirBatches({ setError, setLoading });
  const [items, setItems] = useState<ItemMap>(new Map());
  const [exportRevision, setExportRevision] = useState(0);
  const [externalRun, setExternalRun] = useState<{
    identity: string;
    id: string;
  } | null>(null);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  // 选中素材跨重启恢复：只在启动后的首次装载生效一次，换批次 / 换条目的
  // 既有清空语义不变。素材 id 批次内有效，恢复时对装载结果校验，对不上就放弃。
  const restoredItemRef = useRef<string | null>(
    readStoredString(LABELING_SELECTED_ITEM_KEY),
  );
  const followRun = useRef(true);
  const [foldedItem, setFoldedItem] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [retryRequest, setRetryRequest] = useState(0);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [removal, setRemoval] = useState<{ identity: string; name: string } | null>(
    null,
  );
  const [recovery, setRecovery] = useState<RecoveryRequest | null>(null);
  const [creating, setCreating] = useState(false);
  const [settingsWid, setSettingsWid] = useState<string | null>(null);
  const [newStrategyWid, setNewStrategyWid] = useState<string | null>(null);
  // L2：跑批中点条目会停跟随——给可见提示 + 「继续跟随」钮，不再静默停。
  const [followPaused, setFollowPaused] = useState(false);
  // V15 + A2：跑批中的「当前产出」逐字呈现（思考只展示不落盘，关掉页面即没）。
  const [liveOutput, setLiveOutput] = useState<{
    item: string;
    reasoning: string;
    content: string;
  } | null>(null);
  const identity = `${selection?.workdirId}/${selection?.batchId}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const mounted = useRef(false);
  const refreshVersion = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const selected = selectedItem ? (items.get(selectedItem) ?? null) : null;

  useEffect(() => {
    if (!selection) return;
    let current = true;
    setLoading(true);
    setError("");
    setItems(new Map());
    setSelectedItem(null);
    followRun.current = true;
    setFollowPaused(false);
    setLiveOutput(null);
    setChecked(new Set());
    setSelectionMode(false);
    setRetryRequest(0);
    setSaving(false);
    setRecovery(null);
    setRemoval(null);
    void api
      .listItems(selection.workdirId, selection.batchId)
      .then((view) => {
        if (!current) return;
        const loaded = itemsFromGroups(view.groups);
        setItems(loaded);
        // 跨重启恢复选中素材：只在首次装载生效一次；对装载结果校验不过就放弃。
        const wanted = restoredItemRef.current;
        if (wanted !== null) {
          restoredItemRef.current = null;
          if (loaded.has(wanted)) setSelectedItem(wanted);
        }
      })
      .catch((reason: unknown) => {
        if (current) setError(errorMessage(reason));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [selection]);

  const { batchRunState, setBatchRunState, setRunStateRevision } =
    useBatchRunState(selection);
  const choose = useCallback((row: ItemRow) => {
    if (followRun.current) {
      // 从「跟随」切到「手动看」：跑批中这不是静默的——出可见提示（L2）。
      setFollowPaused(true);
    }
    followRun.current = false;
    setSelectedItem(itemKey(row));
  }, []);
  // 选中素材落盘（跨重启恢复的写入侧）：换批次 / 换条目的清空也如实记 null。
  useEffect(() => {
    writeStoredJson(LABELING_SELECTED_ITEM_KEY, selectedItem);
  }, [selectedItem]);
  const recover = useCallback((row: ItemRow) => {
    setRecovery({
      names: [row.name],
      mode:
        row.status === "unimported" ? "inplace" : row.recoverable ? "restore" : "copy",
    });
  }, []);
  const requestRemoval = useCallback(
    (row: ItemRow) => {
      setRemoval({ identity, name: row.name });
    },
    [identity],
  );
  const toggleCheck = useCallback((item: string) => {
    setChecked((previous) => {
      const next = new Set(previous);
      if (next.has(item)) next.delete(item);
      else next.add(item);
      return next;
    });
  }, []);
  const retryChanged = useCallback(
    (retry: string[]) => {
      if (mounted.current && identityRef.current === identity) {
        setItems((previous) => withRetryItems(previous, retry));
      }
    },
    [identity],
  );
  const refreshItems = useCallback(
    async (requireSuccess = false) => {
      if (!selection) return;
      const version = ++refreshVersion.current;
      try {
        const view = await api.listItems(selection.workdirId, selection.batchId);
        if (
          !mounted.current ||
          identityRef.current !== identity ||
          version !== refreshVersion.current
        )
          return;
        setItems(itemsFromGroups(view.groups));
        setExportRevision((value) => value + 1);
        setError("");
      } catch (reason) {
        if (
          mounted.current &&
          identityRef.current === identity &&
          version === refreshVersion.current
        )
          setError(errorMessage(reason));
        if (requireSuccess) throw reason;
      }
    },
    [selection, identity],
  );
  const removeRetry = useCallback(
    async (item?: string) => {
      if (!selection || saving) return;
      setSaving(true);
      try {
        const result = item
          ? await api.removeRetryItem(selection.workdirId, selection.batchId, item)
          : await api.clearRetryItems(selection.workdirId, selection.batchId);
        if (!mounted.current || identityRef.current !== identity) return;
        retryChanged(result.items);
        setError("");
      } catch (reason) {
        if (mounted.current && identityRef.current === identity)
          setError(errorMessage(reason));
      } finally {
        if (mounted.current && identityRef.current === identity) setSaving(false);
      }
    },
    [selection, saving, identity, retryChanged],
  );
  async function addSelected() {
    if (!selection || saving || !checked.size) return;
    setSaving(true);
    setError("");
    try {
      const result = await api.addRetryItems(selection.workdirId, selection.batchId, [
        ...checked,
      ]);
      if (!mounted.current || identityRef.current !== identity) return;
      retryChanged(result.items);
      setChecked(new Set());
    } catch (reason) {
      if (mounted.current && identityRef.current === identity)
        setError(errorMessage(reason));
    } finally {
      if (mounted.current && identityRef.current === identity) setSaving(false);
    }
  }
  const asset =
    selected && selection
      ? `/api/workdirs/${encodeURIComponent(selection.workdirId)}/items/${encodeURIComponent(selected.item)}/asset`
      : null;

  if (settingsWid)
    return (
      <WorkdirSettings
        key={settingsWid}
        wid={settingsWid}
        onBack={() => {
          setSettingsWid(null);
          void refreshItems();
        }}
        onChanged={() => setDirectoriesRevision((value) => value + 1)}
        onDeleted={() => {
          setSettingsWid(null);
          setDirectoriesRevision((value) => value + 1);
        }}
      />
    );

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="打标">
      {newStrategyWid && (
        <NewStrategyDialog
          key={newStrategyWid}
          wid={newStrategyWid}
          title={
            workdirs.find((entry) => entry.id === newStrategyWid)?.title ??
            newStrategyWid
          }
          nextSeq={(() => {
            const batches =
              workdirs.find((entry) => entry.id === newStrategyWid)?.batches ?? [];
            return batches.length
              ? Math.max(...batches.map((entry) => entry.seq)) + 1
              : 1;
          })()}
          existingCount={
            workdirs.find((entry) => entry.id === newStrategyWid)?.batches.length ?? 0
          }
          onClose={() => setNewStrategyWid(null)}
          onCreated={(batch) => {
            setWorkdirs((previous) =>
              previous.map((entry) =>
                entry.id === newStrategyWid
                  ? { ...entry, batches: [...entry.batches, batch] }
                  : entry,
              ),
            );
            setSelection({ workdirId: newStrategyWid, batchId: batch.id });
            setNewStrategyWid(null);
            setDirectoriesRevision((value) => value + 1);
          }}
        />
      )}
      {selection && removal?.identity === identity && (
        <RemoveUnimportedDialog
          key={`${identity}/${removal.name}`}
          wid={selection.workdirId}
          name={removal.name}
          onClose={() => setRemoval(null)}
          onRemoved={() => void refreshItems()}
        />
      )}
      {selection && recovery && (
        <ImportMaterialsDialog
          key={`recover/${identity}`}
          wid={selection.workdirId}
          names={recovery.names}
          initialMode={recovery.mode}
          onClose={() => setRecovery(null)}
          onImported={() => void refreshItems()}
        />
      )}
      {selection && importOpen && (
        <ImportMaterialsDialog
          key={identity}
          wid={selection.workdirId}
          onClose={() => setImportOpen(false)}
          onImported={() => void refreshItems()}
        />
      )}
      <header className="flex shrink-0 flex-wrap items-center gap-3 px-4 pt-4 pb-3 lg:flex-nowrap lg:gap-4 lg:px-6">
        <div className="flex w-full min-w-0 shrink-0 items-center gap-3 lg:w-(--w-col-left) lg:pr-3">
          <div className="min-w-0 flex-1">
            <BatchSelector
              workdirs={workdirs}
              value={selection}
              onChange={setSelection}
              onSettings={setSettingsWid}
              onNewStrategy={setNewStrategyWid}
              runState={batchRunState}
            />
          </div>
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label="新建跑批"
            onClick={() => setCreating(true)}
          >
            <PlusIcon />
          </Button>
        </div>
        {selection && (
          <BatchConfiguration
            key={`config/${identity}`}
            wid={selection.workdirId}
            batch={selection.batchId}
            compact
          />
        )}
        {selection && (
          <RunControl
            key={`${selection.workdirId}/${selection.batchId}`}
            wid={selection.workdirId}
            batch={selection.batchId}
            externalRunId={
              externalRun?.identity === identity ? externalRun.id : undefined
            }
            retryRequest={retryRequest}
            onRunStatus={(status) => {
              // "idle" = RunControl 探测到空闲（V15 连带的哨兵）：不抹状态章，改触发
              // latestRun 重读——抹空会把刚从磁盘读到的「已完成」等终态一并抹掉
              //（挂载探测与 15 秒慢轮每次空闲都会报一次 idle，徽标最多活 15 秒）；
              // 回读拿到的就是真实终态，V15 要防的「卡 running」照样被复位，语义更准。
              if (status === "idle") setRunStateRevision((value) => value + 1);
              else setBatchRunState(status);
              // 终态 = 跟随提示与「当前产出」都收场（运行结束后回到普通概览）。
              if (status !== "running" && status !== "pending") {
                setFollowPaused(false);
                setLiveOutput(null);
              }
            }}
            onFinish={() => refreshItems(true)}
            onCurrentItem={(item) => {
              if (followRun.current) setSelectedItem(item);
            }}
            onItemUpdate={(event) => {
              refreshVersion.current += 1;
              if (event.status === "started") {
                setLiveOutput({ item: event.item, reasoning: "", content: "" });
              }
              setItems((previous) => withItemUpdate(previous, event));
            }}
            onItemDelta={(event) => {
              setLiveOutput((current) =>
                current === null || current.item !== event.item
                  ? current
                  : event.delta === "reasoning"
                    ? { ...current, reasoning: current.reasoning + event.text }
                    : { ...current, content: current.content + event.text },
              );
            }}
            onImport={() => setImportOpen(true)}
          />
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label="刷新条目"
          disabled={!selection || loading}
          onClick={() => void refreshItems()}
        >
          <RefreshCwIcon />
        </Button>
      </header>
      {error && (
        <FormError className="mx-6 mb-3 text-t-sm text-bad-ink">{error}</FormError>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 pb-6 lg:flex-row lg:overflow-hidden lg:px-6">
        <MaterialsPanel
          items={items}
          selection={selection}
          loading={loading}
          saving={saving}
          selectionMode={selectionMode}
          setSelectionMode={setSelectionMode}
          checked={checked}
          setChecked={setChecked}
          toggleCheck={toggleCheck}
          addSelected={addSelected}
          removeRetry={removeRetry}
          setRetryRequest={setRetryRequest}
          setRecovery={setRecovery}
          selectedItem={selectedItem}
          choose={choose}
          recover={recover}
          requestRemoval={requestRemoval}
        />
        <div className="flex min-w-0 shrink-0 flex-col lg:flex-1 lg:overflow-auto">
          {creating ? (
            // L1（2026-09-21 审计）：新建跑批改为画布内换块——顶栏与左列保留，
            // 返回后选择、折叠与滚动位置都还在（不再整页卸载）。无选中批次时同样可用。
            <NewBatchForm
              onBack={() => setCreating(false)}
              onNavigateToSettings={onNavigateToSettings}
              onOpenWorkbench={onOpenWorkbench}
              onCreated={(value) => {
                setCreating(false);
                setSelection(value);
                void loadWorkdirBatches()
                  .then((loaded) => {
                    if (mounted.current) setWorkdirs(loaded);
                  })
                  .catch((reason: unknown) => {
                    if (mounted.current) setError(errorMessage(reason));
                  });
              }}
            />
          ) : (
            <>
              {followPaused && batchRunState === "running" && (
                // L2：停跟随从「静默停」改成「明说 + 一键恢复」。
                <div className="mb-3 flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-3 py-2 text-t-sm text-text-3">
                  <span>已暂停跟随正在打标的条目。</span>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      followRun.current = true;
                      setFollowPaused(false);
                      setSelectedItem(null);
                    }}
                  >
                    继续跟随
                  </Button>
                </div>
              )}
              {!selected && selection && !loading && (
                <BatchOverview
                  key={identity}
                  wid={selection.workdirId}
                  batch={selection.batchId}
                  items={items}
                  exportRevision={exportRevision}
                  running={batchRunState === "running" || batchRunState === "pending"}
                  liveOutput={liveOutput}
                  onRunStarted={(id) => setExternalRun({ identity, id })}
                  onSelect={choose}
                  onImported={() => void refreshItems()}
                  onImport={() => setImportOpen(true)}
                />
              )}
              {!selected && !selection && (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
                  <FileImageIcon className="size-6" />
                  <p>选择素材</p>
                </div>
              )}
              {selected && (
                <MaterialDetail
                  identity={identity}
                  selectedItem={selectedItem}
                  selected={selected}
                  asset={asset}
                  selection={selection}
                  batches={
                    workdirs.find((entry) => entry.id === selection?.workdirId)?.batches
                  }
                  foldedItem={foldedItem}
                  setFoldedItem={setFoldedItem}
                  onBack={() => {
                    followRun.current = false;
                    setSelectedItem(null);
                  }}
                  onRetryChange={retryChanged}
                />
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
