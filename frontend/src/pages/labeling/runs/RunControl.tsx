import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../api";
import { DialogShell } from "../../../components/dialog-shell";
import { FormError } from "../../../components/form-error";
import { Button } from "../../../components/ui/button";
import { Tip } from "../../../components/ui/tooltip";
import type { ItemDelta, ItemUpdate } from "./items-state";
import { useRunWatch } from "./use-run-watch";

/** 停止钮的方块（2026-10-06 用户裁「按稿改实现」）：稿 i-square＝rect 6,6→18,18（12×12@24
 *  栅格、圆角 2、空心描边）——lucide Square 是 18×18（占栅格 75%）、墨量差 1.5 倍，不照抄。
 *  图标盒仍 16px（Button 基类 [&_svg]:size-4 ＝稿 .btn .ic 档）。 */
function StopSquareIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

/** 继续钮的圆角实心三角：path 与 3.5 同色描边按稿不动（⑪「三个角圆润」裁决不推翻），
 *  viewBox 取稿侧 icons.js VIEWBOX 表的 -3.5 -3 31 30 留白（2026-10-06 用户裁 B：与空心
 *  方块同排重量对等 0.987——transform:scale 弃案，CSS 盒仍 16px、不破坏按钮内布局）。 */
function PlayRoundIcon() {
  return (
    <svg viewBox="-3.5 -3 31 30" aria-hidden="true">
      <path
        d="M7 5.5 18.5 12 7 18.5Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth={3.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

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
  /**
   * 本批的运行史状态（`StrategyView.run_status`：null＝从未跑过，及 failed／running／
   * interrupted／completed）——组显隐按它五态走（对齐批「运行状态组对齐」③；规格权威
   * ＝零件稿 运行状态组.html）：从未跑过／启动失败 → 只出「开始打标」；跑批中 → 进度
   * 文本＋「停止」；已中断 → 只出「继续」；已完成 → 整组不渲染。跑批中视图由活观测
   * `status` 带计数，此 prop 只在观测空闲时判「上一场跑完是什么」。
   */
  runStatus?: string | null;
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
  runStatus,
}: Props) {
  const [unimported, setUnimported] = useState<
    readonly { name: string; reason: string | null }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
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

  // 组显隐按「本批运行史」五态（对齐批「运行状态组对齐」③；活观测在场＝跑批中，
  // 观测空闲时按运行史分流：中断→继续、完成→整组不渲染、未跑/启动失败→开始打标）。
  const historyState = runStatus ?? null;

  if (historyState === "completed" && !status) {
    // 已完成：整组不渲染（右段只剩请求链只读胶囊）；观测与令牌照常运行（hooks 已走）。
    return null;
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
          {/* 进度环已撤（对齐批④）：「在跑」的进度只由选择器 chip 内的 14px 状态图标
              表达，这里的文本是本组唯一的信息载体——字色取正文级 --text-2（⑤）。 */}
          <span className="whitespace-nowrap text-t-sm tabular-nums text-text-2">
            {`${status.counters.attempted ?? 0} / ${status.counters.planned ?? 0} · 失败 ${status.counters.failed ?? 0}`}
          </span>
          {/* 飞行期只失效不换装（对齐批⑥瞬态例外）：aria-disabled＋掐点击，外观同形。 */}
          <Button
            variant="destructive-soft"
            size="sm"
            aria-disabled={busy || undefined}
            className="aria-disabled:pointer-events-none"
            data-testid="run-stop"
            onClick={() => {
              if (busy) return;
              void stop();
            }}
          >
            <StopSquareIcon />
            停止
          </Button>
        </>
      ) : historyState === "interrupted" ? (
        <>
          {/* 已中断 → 只出「继续」（新增钮）：续跑＝全量模式，后端对已有完整产物的
              条目自动跳过（runner _plan_full 的 skip 语义），页内另有续跑提示条承载说明。 */}
          <Button
            size="sm"
            aria-disabled={busy || undefined}
            className="aria-disabled:pointer-events-none"
            onClick={() => {
              if (busy) return;
              void start("full");
            }}
          >
            <PlayRoundIcon />
            继续
          </Button>
        </>
      ) : (
        <>
          {/* 禁用必须说明原因（按钮规范）；飞行期只失效不换装（对齐批⑥瞬态例外）。 */}
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
              aria-disabled={busy || reconnecting || !known || undefined}
              className="aria-disabled:pointer-events-none"
              onClick={() => {
                if (busy || reconnecting || !known) return;
                void prepareFullRun();
              }}
            >
              开始打标
            </Button>
          </Tip>
        </>
      )}
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
