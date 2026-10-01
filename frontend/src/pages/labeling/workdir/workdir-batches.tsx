import { ChevronDownIcon, EyeIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../api";
import type { components } from "../../../api-types.gen";
import { DialogShell } from "../../../components/dialog-shell";
import { FormError } from "../../../components/form-error";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Tip } from "../../../components/ui/tooltip";
import { BatchConfiguration } from "../batching/BatchConfiguration";
import type { Batch } from "./use-workdir-data";

type BatchAction = {
  batch: Batch;
  kind: "hide" | "delete" | "rename";
};

/** L15：稳定的 ref 回调——只在元素挂载时聚焦一次，重渲染不抢焦点。 */
function autoFocusRef(element: HTMLInputElement | null): void {
  element?.focus();
}

/** 工作目录策略区块：策略列表（展开配置、就地改名、停用/启用、删除）与确认弹窗。 */
export function WorkdirBatches({
  wid,
  batches,
  stats,
  runStates,
  runError,
  busy,
  setBusy,
  onRefresh,
  onCreate,
  onSnapshot,
}: {
  wid: string;
  batches: Batch[];
  stats: components["schemas"]["WorkdirStatsView"] | null;
  runStates: Record<string, boolean>;
  runError: string;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onRefresh: () => void;
  onCreate: () => void;
  onSnapshot: (batchId: string) => void;
}) {
  const [action, setAction] = useState<BatchAction | null>(null);
  const [name, setName] = useState("");
  const [actionError, setActionError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const mounted = useRef(false);
  const actionPending = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function requestAction(batch: Batch, kind: "hide" | "delete" | "rename") {
    setAction({ batch, kind });
    setName(batch.name);
    setActionError("");
  }

  async function apply() {
    if (!action || actionPending.current || (action.kind === "rename" && !name.trim()))
      return;
    actionPending.current = true;
    setBusy(true);
    setActionError("");
    try {
      if (action.kind === "delete") await api.deleteBatch(wid, action.batch.id);
      else if (action.kind === "hide")
        await api.setBatchActive(wid, action.batch.id, !action.batch.active);
      else await api.updateBatch(wid, action.batch.id, { name: name.trim() });
      if (!mounted.current) return;
      setAction(null);
      onRefresh();
    } catch (reason) {
      if (mounted.current) setActionError(errorMessage(reason));
    } finally {
      actionPending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <>
      <section
        className="mt-4 rounded-xl border border-border bg-card p-4"
        aria-label="目录策略"
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-t-md font-medium">策略（{batches.length}）</h2>
          <Button size="sm" onClick={onCreate}>
            <PlusIcon />
            新增策略
          </Button>
        </div>
        {runError && (
          <FormError className="pb-2 text-t-sm text-bad-ink">{runError}</FormError>
        )}
        {batches.length === 0 && (
          <p className="py-2 text-t-sm text-text-3">还没有策略</p>
        )}
        {batches.map((batch) => (
          <div key={batch.id} className="border-b border-border last:border-0">
            <div key={batch.id} className="flex flex-wrap items-center gap-3 py-3">
              <Button
                variant="ghost"
                size="sm"
                className="w-(--h-sm) p-0"
                aria-label={`展开策略配置 ${batch.id}`}
                aria-expanded={expanded.has(batch.id)}
                onClick={() =>
                  setExpanded((previous) => {
                    const next = new Set(previous);
                    if (next.has(batch.id)) next.delete(batch.id);
                    else next.add(batch.id);
                    return next;
                  })
                }
              >
                <ChevronDownIcon
                  className={expanded.has(batch.id) ? "" : "-rotate-90"}
                />
              </Button>
              <span
                className={`inline-flex h-4.5 shrink-0 items-center rounded-full px-2 text-t-xs font-medium ${runStates[batch.id] ? "bg-info-ink text-on-ink" : batch.active ? "bg-ok-ink text-on-ink" : "bg-muted text-text-3"}`}
              >
                {/* Q3/Q7（components/marks.md）：状态章一律实底彩色 + 白字——
                    此前的带色文字是与原型 shell.css 同源的规范漂移。 */}
                {runStates[batch.id] ? "运行中" : batch.active ? "活跃" : "已停用"}
              </span>
              {action?.kind === "rename" && action.batch.id === batch.id ? (
                <Input
                  aria-label={`策略名称 ${batch.id}`}
                  className="h-(--h-sm) w-48 max-w-full"
                  value={name}
                  disabled={busy}
                  // L15（2026-09-21 审计）：稳定的 ref 回调只在挂载时聚焦一次——
                  // 内联箭头每次渲染重建会把光标反复拉回输入框。
                  ref={autoFocusRef}
                  onChange={(event) => setName(event.currentTarget.value)}
                  onBlur={() => {
                    if (name.trim()) void apply();
                  }}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) return;
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void apply();
                    }
                    if (event.key === "Escape" && !actionPending.current) {
                      event.preventDefault();
                      setAction(null);
                    }
                  }}
                />
              ) : (
                <Tip label="改名">
                  <button
                    type="button"
                    className="min-w-0 break-all rounded-sm text-left font-medium hover:bg-accent"
                    aria-label={`改名策略 ${batch.name}`}
                    disabled={busy}
                    onClick={() => requestAction(batch, "rename")}
                  >
                    {batch.name}
                  </button>
                </Tip>
              )}
              <span className="text-t-sm text-text-4">{batch.id}</span>
              <span className="ml-auto text-t-sm text-text-3">
                产物 {batch.product_count}
                {stats && ` / ${stats.asset_count}`}
              </span>
              <Tip label="查看快照">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-(--h-sm) p-0"
                  aria-label={`查看快照 ${batch.id}`}
                  onClick={() => onSnapshot(batch.id)}
                >
                  <EyeIcon />
                </Button>
              </Tip>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => requestAction(batch, "hide")}
              >
                {/* Q3：同一动作统一为「停用 / 启用」（PRD F3/F9 与后端 docstring 同口径），
                    不再与「隐藏 / 显示」三种写法并存。 */}
                {batch.active ? "停用" : "启用"}
              </Button>
              <Tip
                label={
                  runStates[batch.id]
                    ? "运行中不可删除"
                    : runStates[batch.id] === false
                      ? ""
                      : "正在确认运行状态"
                }
              >
                <Button
                  variant="destructive"
                  size="sm"
                  className="w-(--h-sm) p-0"
                  aria-label={`删除策略 ${batch.id}`}
                  disabled={runStates[batch.id] !== false || busy}
                  onClick={() => requestAction(batch, "delete")}
                >
                  <Trash2Icon />
                </Button>
              </Tip>
            </div>
            {action?.kind === "rename" &&
              action.batch.id === batch.id &&
              actionError && (
                <FormError className="pb-2 text-t-sm text-bad-ink">
                  {actionError}
                </FormError>
              )}
            {expanded.has(batch.id) && (
              <BatchConfiguration wid={wid} batch={batch.id} />
            )}
          </div>
        ))}
      </section>
      {action && action.kind !== "rename" && (
        <DialogShell
          open
          onOpenChange={(open) => {
            if (!open && !busy) setAction(null);
          }}
          title={
            action.kind === "delete"
              ? "删除策略？"
              : action.batch.active
                ? "停用策略？"
                : "启用策略？"
          }
          description={`${action.batch.name} · ${action.batch.id}`}
          cancel={{
            label: "取消",
            variant: "outline",
            disabled: busy,
            onClick: () => setAction(null),
          }}
          confirm={{
            label: busy ? "正在保存" : "确认",
            variant: action.kind === "delete" ? "destructive-fill" : "default",
            disabled: busy,
            onClick: () => void apply(),
          }}
        >
          <p className="text-t-sm text-text-3">
            {action.kind === "delete"
              ? `将删除本策略的 ${action.batch.product_count} 个产物、快照和重试记录，素材保留。`
              : action.batch.active
                ? "若此策略正在运行，确认后将停止本次运行；已完成条目与产物保留。停用后可在此处重新启用。"
                : "重新启用后可在打标页选择此策略。"}
          </p>
          {actionError && <FormError className="text-bad-ink">{actionError}</FormError>}
        </DialogShell>
      )}
    </>
  );
}
