import { Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../api";
import { DialogShell } from "../../../components/dialog-shell";
import { FormError } from "../../../components/form-error";
import { Button } from "../../../components/ui/button";
import { Tip } from "../../../components/ui/tooltip";
import type { ItemDelta, ItemUpdate } from "./items-state";
import { useRunWatch } from "./use-run-watch";

interface Props {
  wid: string;
  batch: string;
  onFinish: () => void | Promise<void>;
  onItemUpdate?: (event: ItemUpdate) => void;
  /** 流式增量转发（A2：跑批逐字呈现）；不转发时增量事件只被忽略。 */
  onItemDelta?: (event: ItemDelta) => void;
  onCurrentItem?: (item: string | null) => void;
  onImport?: () => void;
  externalRunId?: string;
  /**
   * 左列「重试列表」组头发起的开始重试请求（令牌式触发：值变化即发车）。
   *
   * 为什么用令牌而不是把 `start` 提上去：`start` 要用观测域的生命周期代次
   * （`lifecycle`）做迟到响应护栏，提到父层就得把整套护栏也搬上去。令牌只
   * 传「点了」这一个事实，动作仍由持有护栏的这里执行——与页面别处
   * 「revision 计数器驱动重取」是同一个范式。
   */
  retryRequest?: number;
  /**
   * 报告本批次运行状态的每一次变化（进行中与终态都报），供顶栏状态章显示；
   * 语义见 use-run-watch 的同名选项。
   */
  onRunStatus?: (status: string) => void;
}

/** 断流不代表运行结束，重连前用 current 确认运行并刷新条目。 */
export function RunControl({
  wid,
  batch,
  onFinish,
  onImport,
  onItemUpdate,
  onItemDelta,
  onCurrentItem,
  externalRunId,
  retryRequest,
  onRunStatus,
}: Props) {
  const [unimported, setUnimported] = useState<
    readonly { name: string; reason: string | null }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [retryConfirming, setRetryConfirming] = useState(false);
  const actionPending = useRef(false);
  const {
    status,
    current,
    reconnecting,
    known,
    error,
    setError,
    setStatus,
    setAcceptedRunId,
    lifecycle,
    reportStatus,
  } = useRunWatch({
    wid,
    batch,
    onFinish,
    onItemUpdate,
    onItemDelta,
    onCurrentItem,
    externalRunId,
    onRunStatus,
  });

  const start = useCallback(
    async (mode: "full" | "retry") => {
      if (actionPending.current) return;
      const generation = lifecycle.current;
      actionPending.current = true;
      setBusy(true);
      setError("");
      try {
        const accepted = await api.startRun(wid, batch, mode);
        if (lifecycle.current !== generation) return;
        setStatus({
          run_id: accepted.run_id,
          status: "running",
          mode,
          batch: Number(batch.slice(1)),
          counters: {},
          current_item: null,
          error: null,
        });
        reportStatus("running");
        setAcceptedRunId(accepted.run_id);
      } catch (reason) {
        if (lifecycle.current === generation) setError(errorMessage(reason));
      } finally {
        actionPending.current = false;
        if (lifecycle.current === generation) {
          setBusy(false);
          setConfirming(false);
        }
      }
    },
    [batch, wid, lifecycle, setError, setStatus, reportStatus, setAcceptedRunId],
  );

  // 左列组头的「开始重试」：令牌从 0 起，父层点一次加一；切换批次时父层清零，
  // 新挂载的组件因此不会被上一批次的令牌误触发。
  useEffect(() => {
    if (!retryRequest) return;
    void start("retry");
  }, [retryRequest, start]);

  const stop = useCallback(async () => {
    if (actionPending.current) return;
    const generation = lifecycle.current;
    actionPending.current = true;
    setBusy(true);
    try {
      await api.stopRun(wid, batch);
    } catch (reason) {
      if (lifecycle.current === generation) setError(errorMessage(reason));
    } finally {
      actionPending.current = false;
      if (lifecycle.current === generation) setBusy(false);
    }
  }, [batch, wid, lifecycle, setError]);

  async function prepareFullRun() {
    if (actionPending.current) return;
    const generation = lifecycle.current;
    actionPending.current = true;
    setBusy(true);
    setError("");
    try {
      const view = await api.listItems(wid, batch);
      if (lifecycle.current !== generation) return;
      const rows = (view.groups.unimported ?? []).map((row) => ({
        name: row.name,
        reason: row.reason ?? null,
      }));
      setUnimported(rows);
      if (rows.length) setConfirming(true);
      else {
        actionPending.current = false;
        await start("full");
      }
    } catch (reason) {
      if (lifecycle.current === generation) setError(errorMessage(reason));
    } finally {
      actionPending.current = false;
      if (lifecycle.current === generation) setBusy(false);
    }
  }

  return (
    <section className="flex items-center gap-3" aria-label="运行控制">
      {error && <FormError className="text-t-sm text-bad-ink">{error}</FormError>}
      {reconnecting && (
        <span role="status" className="text-t-sm text-warn-ink">
          正在重新连接
        </span>
      )}
      {status ? (
        <>
          <span className="sr-only">{current ? `正在处理：${current}` : "运行中"}</span>
          <svg
            viewBox="0 0 20 20"
            className="size-4.5 shrink-0 -rotate-90"
            role="progressbar"
            aria-label="运行进度"
            aria-valuemin={0}
            aria-valuemax={status.counters.planned || 1}
            aria-valuenow={status.counters.attempted ?? 0}
          >
            <circle
              cx="10"
              cy="10"
              r="6"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              className="text-n-200"
            />
            <circle
              cx="10"
              cy="10"
              r="6"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              pathLength="100"
              strokeDasharray="100"
              strokeDashoffset={
                100 -
                Math.min(
                  100,
                  ((status.counters.attempted ?? 0) / (status.counters.planned || 1)) *
                    100,
                )
              }
              className="text-primary"
            />
          </svg>
          <span className="whitespace-nowrap text-t-sm tabular-nums text-muted-foreground">
            {`${status.counters.attempted ?? 0} / ${status.counters.planned ?? 0} · 失败 ${status.counters.failed ?? 0}`}
          </span>
          <Button
            variant="destructive-soft"
            size="sm"
            disabled={busy}
            data-testid="run-stop"
            onClick={() => void stop()}
          >
            <Square aria-hidden="true" />
            停止
          </Button>
        </>
      ) : (
        <>
          {/* L6（2026-09-21 审计 / components/button.md）：禁用必须说明原因。 */}
          <Tip
            label={
              busy
                ? "上一个操作还在处理中"
                : reconnecting
                  ? "正在重新连接运行状态"
                  : !known
                    ? "正在确认运行状态…"
                    : ""
            }
          >
            <Button
              size="sm"
              disabled={busy || reconnecting || !known}
              onClick={() => void prepareFullRun()}
            >
              开始打标
            </Button>
          </Tip>
          <Tip
            label={
              busy
                ? "上一个操作还在处理中"
                : reconnecting
                  ? "正在重新连接运行状态"
                  : !known
                    ? "正在确认运行状态…"
                    : "将按重试列表的当前名单重新打标"
            }
          >
            <Button
              variant="outline"
              size="sm"
              disabled={busy || reconnecting || !known}
              onClick={() => setRetryConfirming(true)}
            >
              开始重试
            </Button>
          </Tip>
        </>
      )}
      {/* Q1（2026-09-21 复核定案）：名单发车不可撤销，顶栏「开始重试」必须过确认。 */}
      <DialogShell
        open={retryConfirming}
        onOpenChange={setRetryConfirming}
        title="开始重试？"
        description={
          <>
            将按重试列表的当前名单逐条重新打标（名单在发车瞬间拍快照）。发车后不可撤销，
            等它跑完或点「停止」前不能再发车。
          </>
        }
        cancel={{
          label: "取消",
          variant: "outline",
          onClick: () => setRetryConfirming(false),
        }}
        confirm={{
          label: "开始重试",
          variant: "default",
          disabled: busy,
          onClick: () => {
            setRetryConfirming(false);
            void start("retry");
          },
        }}
      />
      <DialogShell
        open={confirming}
        onOpenChange={setConfirming}
        title="未导入素材确认"
        description={
          <>有 {unimported.length} 个工作目录文件未登记，不会进入本次跑批。</>
        }
        cancel={{
          label: "先去导入",
          variant: "outline",
          onClick: () => {
            setConfirming(false);
            onImport?.();
          },
        }}
        confirm={{
          label: "仍要开始",
          variant: "default",
          disabled: busy,
          onClick: () => void start("full"),
        }}
      >
        <ul
          className="max-h-48 overflow-auto rounded-md border border-border p-3 text-t-sm"
          aria-label="未导入素材"
        >
          {unimported.map((row) => (
            <li key={row.name}>
              {row.name}
              {row.reason && (
                <span className="text-muted-foreground"> · {row.reason}</span>
              )}
            </li>
          ))}
        </ul>
      </DialogShell>
    </section>
  );
}
