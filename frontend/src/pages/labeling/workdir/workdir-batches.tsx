import { BookOpenIcon, ChevronDownIcon, PlusIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../api";
import type { components } from "../../../api-types.gen";
import { DialogShell } from "../../../components/dialog-shell";
import { FormError } from "../../../components/form-error";
import { TrashIcon } from "../../../components/icons";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Switch } from "../../../components/ui/switch";
import { Tip } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";
import { BatchConfiguration } from "../batching/BatchConfiguration";
import type { Batch } from "./use-workdir-data";

type BatchAction = {
  batch: Batch;
  kind: "hide" | "delete";
};

/** L15：稳定的 ref 回调——只在元素挂载时聚焦一次，重渲染不抢焦点。 */
function autoFocusRef(element: HTMLInputElement | null): void {
  element?.focus();
}

/**
 * 行首状态点六态（稿 §32＋marks.md 状态点；停用置灰优先，启用态按最近运行）：
 * 未开始／运行中＝蓝、已完成＝绿、已中断／失败＝红、已停用＝灰。运行中由轮询实时覆盖，
 * 未回包先按列表 `run_status` 出点；点本体挂 `role="img" aria-label`，短文字走悬停 Tip。
 */
function runDot(
  batch: Batch,
  running: boolean | undefined,
): { tone: string; label: string } {
  if (!batch.active) return { tone: "bg-n-400", label: "已停用" };
  if (running) return { tone: "bg-info-dot", label: "运行中" };
  if (batch.run_status === "completed") return { tone: "bg-ok-dot", label: "已完成" };
  if (batch.run_status === "interrupted")
    return { tone: "bg-bad-dot", label: "已中断" };
  if (batch.run_status === "failed") return { tone: "bg-bad-dot", label: "失败" };
  // 没有运行记录（run_status 为 null，或桩数据里干脆没带这字段）＝未开始。
  if (batch.run_status === undefined || batch.run_status === null)
    return { tone: "bg-info-dot", label: "未开始" };
  return { tone: "bg-info-dot", label: "运行中" };
}

/** 工作目录策略区块：策略行（整行可点折叠、状态点、就地改名、行尾〔快照／删除／开关〕）与两枚确认弹窗。 */
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
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [actionError, setActionError] = useState("");
  const [renameError, setRenameError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const mounted = useRef(false);
  const actionPending = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function toggleExpanded(batchId: string): void {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  }

  function startRename(batch: Batch): void {
    setRenaming(batch.id);
    setName(batch.name);
    setRenameError("");
  }

  function requestAction(batch: Batch, kind: BatchAction["kind"]): void {
    setAction({ batch, kind });
    setActionError("");
  }

  async function run(
    kind: BatchAction["kind"] | "rename",
    batch: Batch,
  ): Promise<void> {
    if (actionPending.current || (kind === "rename" && !name.trim())) return;
    actionPending.current = true;
    setBusy(true);
    setActionError("");
    setRenameError("");
    try {
      if (kind === "delete") await api.deleteBatch(wid, batch.id);
      else if (kind === "hide") await api.setBatchActive(wid, batch.id, !batch.active);
      else await api.updateBatch(wid, batch.id, { name: name.trim() });
      if (!mounted.current) return;
      if (kind === "rename") setRenaming(null);
      else setAction(null);
      onRefresh();
    } catch (reason) {
      if (!mounted.current) return;
      const text = errorMessage(reason);
      if (kind === "rename") setRenameError(text);
      else setActionError(text);
    } finally {
      actionPending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  /** 丙（条件式确认）：只有「停用且正在运行」这一真后果拦一下，启用与停用空闲都直接生效。 */
  function toggleActive(batch: Batch, checked: boolean): void {
    if (!checked && runStates[batch.id]) {
      requestAction(batch, "hide");
      return;
    }
    void run("hide", batch);
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
          <div className="py-2 text-center text-t-sm text-text-3">还没有策略</div>
        )}
        {batches.map((batch, index) => {
          const dot = runDot(batch, runStates[batch.id]);
          const isLast = index === batches.length - 1;
          return (
            <div key={batch.id}>
              <div
                className={cn(
                  // 行不折行（用户三条令：不折行＞信息完整＞输入框占满剩余）；悬停墨底走
                  // ::before 圆角带（两侧外扩 6px、内呼吸 8px），hairline 与内容对齐不动。
                  "relative z-0 flex min-w-0 cursor-pointer items-center gap-3 rounded-md px-0.5 py-3",
                  "before:absolute before:inset-y-0 before:-inset-x-1.5 before:-z-10 before:rounded-md before:content-[''] hover:before:bg-accent",
                  !isLast && "border-b border-border",
                )}
              >
                {/* 「点行内非控件处＝折叠/展开」的落法：一整层不可聚焦的命中钮铺在行底，
                    控件各挂 relative 浮到它上面——点状态点／id／计数／空白即折叠，点控件即其自身动作；
                    键盘仍走行首折叠钮（稿明写「chevron 保留为键盘可达显式钮」，故本层不进 Tab 序）。 */}
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden="true"
                  className="absolute inset-0 cursor-pointer rounded-md"
                  onClick={() => toggleExpanded(batch.id)}
                />
                <Button
                  className="relative z-10"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`展开策略配置 ${batch.id}`}
                  aria-expanded={expanded.has(batch.id)}
                  onClick={() => toggleExpanded(batch.id)}
                >
                  <ChevronDownIcon
                    className={expanded.has(batch.id) ? "" : "-rotate-90"}
                  />
                </Button>
                <Tip label={dot.label}>
                  {/* 点浮到命中层之上，悬停 Tip 才拿得到指针（代价：6px 点本体不兼作折叠热区，
                      点周空白／id／计数照常可点——两笔都出自稿，取「Tip 必须能用」这一侧）。 */}
                  <span
                    className={cn(
                      "relative z-10 size-1.5 shrink-0 rounded-full",
                      dot.tone,
                    )}
                    role="img"
                    aria-label={dot.label}
                  />
                </Tip>
                {renaming === batch.id ? (
                  <Input
                    aria-label={`策略名称 ${batch.id}`}
                    className="relative z-10 h-(--h-sm) w-auto min-w-24 max-w-full field-sizing-content"
                    value={name}
                    disabled={busy}
                    // L15（2026-09-21 审计）：稳定的 ref 回调只在挂载时聚焦一次——
                    // 内联箭头每次渲染重建会把光标反复拉回输入框。
                    ref={autoFocusRef}
                    onChange={(event) => setName(event.currentTarget.value)}
                    onBlur={() => {
                      if (name.trim()) void run("rename", batch);
                    }}
                    onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing) return;
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void run("rename", batch);
                      }
                      if (event.key === "Escape" && !actionPending.current) {
                        event.preventDefault();
                        setRenaming(null);
                      }
                    }}
                  />
                ) : (
                  <Tip label={batch.name}>
                    <button
                      type="button"
                      className="relative z-10 min-w-0 truncate whitespace-nowrap rounded-sm border border-transparent -ml-[5px] px-1 py-px text-left font-medium text-text-1 hover:border-input"
                      aria-label={`改名策略 ${batch.name}`}
                      disabled={busy}
                      onClick={() => startRename(batch)}
                    >
                      {batch.name}
                    </button>
                  </Tip>
                )}
                <span className="block min-w-0 shrink-0 truncate whitespace-nowrap text-t-sm max-md:shrink">
                  <span className="text-text-4">{batch.id}</span>
                  <span className="ml-3 tabular-nums text-text-3">
                    产物 {batch.product_count}
                    {stats && ` / ${stats.asset_count}`}
                  </span>
                </span>
                {renameError && (
                  <span
                    role="alert"
                    className="min-w-0 shrink truncate whitespace-nowrap text-t-sm text-bad-ink"
                  >
                    {renameError}
                  </span>
                )}
                <span className="relative z-10 ml-auto flex shrink-0 items-center gap-3">
                  <Tip label="查看快照">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`查看快照 ${batch.id}`}
                      onClick={() => onSnapshot(batch.id)}
                    >
                      <BookOpenIcon />
                    </Button>
                  </Tip>
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
                      // 危险图标钮档（§7）：静止中性灰、悬停才显红——红是状态色不常驻。
                      className="hover:bg-bad-ink/12 hover:text-bad-ink"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`删除策略 ${batch.id}`}
                      disabled={runStates[batch.id] !== false || busy}
                      onClick={() => requestAction(batch, "delete")}
                    >
                      <TrashIcon />
                    </Button>
                  </Tip>
                  <Switch
                    checked={batch.active}
                    disabled={busy}
                    aria-label={`启用 ${batch.name}`}
                    onCheckedChange={(checked) => toggleActive(batch, checked)}
                  />
                </span>
              </div>
              {expanded.has(batch.id) && (
                <BatchConfiguration wid={wid} batch={batch.id} />
              )}
            </div>
          );
        })}
      </section>
      {action && (
        <DialogShell
          open
          onOpenChange={(open) => {
            if (!open) setAction(null);
          }}
          footLine
          title={
            action.kind === "delete"
              ? `删除策略「${action.batch.name}」？`
              : `停用策略「${action.batch.name}」？`
          }
          note={action.kind === "delete" ? "此操作不可撤销" : undefined}
          cancel={{
            label: "取消",
            variant: "secondary",
            onClick: () => setAction(null),
          }}
          confirm={{
            label: action.kind === "delete" ? "删除" : "中断并停用",
            variant: "danger-text",
            onClick: () => void run(action.kind, action.batch),
          }}
          flight={busy}
        >
          <p className="text-t-sm text-text-3">
            {action.kind === "delete"
              ? `将删除本策略的 ${action.batch.product_count} 个产物、快照、重试记录与运行记录，素材保留。`
              : "此策略正在运行。停用会中断本次运行：已完成条目与产物保留，未完成条目按中断记录，可随时重新启用后续跑。"}
          </p>
          {actionError && (
            <FormError data-dialog-error className="text-t-sm text-bad-ink">
              {actionError}
            </FormError>
          )}
        </DialogShell>
      )}
    </>
  );
}
