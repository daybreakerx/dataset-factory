import { InfoIcon, TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, corruptedRunOf } from "../../../api";
import { DialogShell } from "../../../components/dialog-shell";
import { FormError } from "../../../components/form-error";
import { Button } from "../../../components/ui/button";
import { Tip } from "../../../components/ui/tooltip";
import { reportError } from "../../../lib/feedback";
import { cn } from "../../../lib/utils";
import type { ItemDelta, ItemUpdate } from "./items-state";
import { JournalCorruptedLine } from "./journal-corrupted-line";
import { useRunWatch } from "./use-run-watch";

/** 组内反馈行的让位与图标档（§22 `.lb-runhint`／`.lb-runerr`／`.lb-runwarn` 三条共用）：
 *  正常区间全文在场、放不下才省略号；折行档（<874）解除 min-width 压到 auto；图标档
 *  （<663）转 inline-flex——文字隐、14px 图标显、命中区外扩 5px（稿 `::before inset -5px`），
 *  组内间距随之收到 --s-2（在组根声明）。 */
const FEEDBACK_LINE =
  "min-w-0 overflow-hidden text-ellipsis " +
  "whitespace-nowrap text-t-sm @max-[874px]/lbctx:min-w-auto " +
  "@max-[663px]/lbctx:relative @max-[663px]/lbctx:inline-flex " +
  "@max-[663px]/lbctx:flex-none @max-[663px]/lbctx:items-center " +
  "@max-[663px]/lbctx:before:absolute @max-[663px]/lbctx:before:-inset-[5px] " +
  "@max-[663px]/lbctx:before:content-['']";

/** 反馈行图标（仅图标档显形）：稿 `role="img"`＋`aria-label` 同文读屏，全文气泡走 `Tip`
 *  （稿侧原生 `title`，实现侧按「运行状态组」稿对账条改齐 `Tip`）。 */
function FeedbackIcon({ tone, text }: { tone: "info" | "alert"; text: string }) {
  const Icon = tone === "info" ? InfoIcon : TriangleAlertIcon;
  return (
    <Tip label={text}>
      <Icon
        role="img"
        aria-label={text}
        className="hidden size-(--icon-sm) shrink-0 @max-[663px]/lbctx:inline-flex"
      />
    </Tip>
  );
}

/** 进度读数（§22 `.lb-sbstat`）：极窄档（≤512）数字 ≥1000 走 X.Xk 缩写让位，
 *  两式同场按容器宽互斥显隐（放不下仍由 4em floor ＋省略号兜住）。 */
function kCount(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : `${value}`;
}

function progressText(attempted: number, planned: number, failed: number): string {
  return `${attempted} / ${planned} · 失败 ${failed}`;
}

/** 停止钮的方块（2026-10-06 用户裁「按稿改实现」）：稿 i-square＝rect 6,6→18,18（12×12@24
 *  栅格、圆角 2、空心描边）——lucide Square 是 18×18（占栅格 75%）、墨量差 1.5 倍，不照抄。
 *  图标盒仍 16px（Button 基类 [&_svg]:size-(--icon-md) ＝稿 .btn .ic 档）。 */
function StopSquareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
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
   * 发车受理成功上报（T14）：带这一场的模式（full／retry）——父层据此冻结「这一场
   * 吃哪几行」的名单，做左列排队中的视图层覆盖（实现侧名单住在后端，前端发车时
   * 按当前清单快照冻结）。
   */
  onRunStarted?: (mode: "full" | "retry") => void;
  /** SSE 断流上报（E5「已中断」停因机制）：订阅中的连接意外断开进重连退避时调一次。 */
  onStreamDrop?: () => void;
  /** 重连成功且运行仍在：父层清掉网络中断标记。 */
  onStreamRestore?: () => void;
  /** 损坏流水就地清理完成后，重拉条目清单（红字自消之外，左列分组也要跟着回正）。 */
  onItemsRefresh?: () => void;
  /**
   * 本批的运行史状态（`StrategyView.run_status`：null＝从未跑过，及 failed／running／
   * interrupted／completed）——组显隐按它五态走（规格权威
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
  onItemUpdate,
  onItemDelta,
  onCurrentItem,
  externalRunId,
  retryRequest,
  onRunStatus,
  onRunStarted,
  onStreamDrop,
  onStreamRestore,
  runStatus,
  onItemsRefresh,
}: Props) {
  const [busy, setBusy] = useState(false);
  // 停两档（2026-10-06 用户裁 B）：点「停止」先弹窗问「等不等当前条目打完」，两档可改选——
  // 选了等条目之后，窗口内「停止」钮照旧可点、再点重开本弹窗。
  const [stopDialog, setStopDialog] = useState(false);
  const [stopMode, setStopMode] = useState<"graceful" | "immediate" | null>(null);
  // 后端带出 run 才有就地出口：四处出错面同一把尺，不出现「同一句红字有的面能点、有的面不能点」。
  const [errorRun, setErrorRun] = useState<string | null>(null);
  const actionPending = useRef(false);
  // T14：onRunStarted 走 ref 承接——它常是父层内联函数（身份每渲染变），直接进
  // start 的 deps 会让 retry effect 依赖漂移、重复发车（rebuild-imports e2e 实锤）。
  const runStartedRef = useRef(onRunStarted);
  runStartedRef.current = onRunStarted;
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
    onStreamDrop,
    onStreamRestore,
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
        // T14：这一场的名单由父层按当前清单快照冻结（视图层覆盖用）。
        runStartedRef.current?.(mode);
      } catch (reason) {
        if (lifecycle.current === generation) {
          setError(reportError(reason) ?? "");
          setErrorRun(corruptedRunOf(reason));
        }
      } finally {
        actionPending.current = false;
        if (lifecycle.current === generation) setBusy(false);
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

  const stop = useCallback(
    async (mode: "graceful" | "immediate") => {
      if (actionPending.current) return;
      const generation = lifecycle.current;
      actionPending.current = true;
      setBusy(true);
      setStopDialog(false);
      try {
        await api.stopRun(wid, batch, mode);
        if (lifecycle.current === generation) setStopMode(mode);
      } catch (reason) {
        if (lifecycle.current === generation) {
          setError(reportError(reason) ?? "");
          setErrorRun(corruptedRunOf(reason));
        }
      } finally {
        actionPending.current = false;
        if (lifecycle.current === generation) setBusy(false);
      }
    },
    [batch, wid, lifecycle, setError],
  );

  // 组显隐按「本批运行史」五态（活观测在场＝跑批中，
  // 观测空闲时按运行史分流：中断→继续、完成→整组不渲染、未跑/启动失败→开始打标）。
  const historyState = runStatus ?? null;

  if (historyState === "completed" && !status) {
    // 已完成：整组不渲染（右段只剩请求链只读胶囊）；观测与令牌照常运行（hooks 已走）。
    // 最小例外（稿样图 09，2026-10-10 用户裁「放宽」）：原「已完成 → 整组不渲染」遇损坏
    // 无容器（红字链接没处可去）——放宽为组渲染、仅渲染该行（任何动作钮仍不出）。
    if (errorRun === null) return null;
    return (
      <section
        className="ml-auto flex min-w-0 shrink-0 items-center"
        aria-label="运行控制"
      >
        <JournalCorruptedLine
          wid={wid}
          run={errorRun}
          onCleaned={() => {
            setError("");
            setErrorRun(null);
            onItemsRefresh?.();
          }}
        />
      </section>
    );
  }

  const attempted = status?.counters.attempted ?? 0;
  const planned = status?.counters.planned ?? 0;
  const failed = status?.counters.failed ?? 0;

  return (
    <section
      className="ml-auto flex min-w-0 shrink-0 items-center gap-3 @max-[874px]/lbctx:col-start-2 @max-[874px]/lbctx:row-start-1 @max-[874px]/lbctx:ml-0 @max-[874px]/lbctx:max-w-full @max-[874px]/lbctx:min-w-auto @max-[874px]/lbctx:justify-self-end @max-[663px]/lbctx:gap-2 @max-[512px]/lbctx:min-w-0"
      aria-label="运行控制"
    >
      {errorRun ? (
        <JournalCorruptedLine
          wid={wid}
          run={errorRun}
          iconTier
          onCleaned={() => {
            setError("");
            setErrorRun(null);
            onItemsRefresh?.();
          }}
        />
      ) : (
        error && (
          <FormError className={cn(FEEDBACK_LINE, "text-bad-ink")}>
            <FeedbackIcon tone="alert" text={error} />
            <span className="@max-[663px]/lbctx:hidden">{error}</span>
          </FormError>
        )
      )}
      {reconnecting && (
        <span role="status" className={cn(FEEDBACK_LINE, "text-warn-ink")}>
          <FeedbackIcon tone="alert" text="正在重新连接" />
          <span className="@max-[663px]/lbctx:hidden">正在重新连接</span>
        </span>
      )}
      {status ? (
        <>
          <span className="sr-only">{current ? `正在处理：${current}` : "运行中"}</span>
          {/* 组内反馈行（④，§22 .lb-runhint 中性档）：等条目那档还要占一个条目时长，得说明
              「为什么还在跑」；立即中断是秒级瞬态、不补这一行（状态随即转「已中断」）。
              行序照稿（样图 11）：反馈行→进度文本→动作钮。 */}
          {stopMode === "graceful" && (
            <span role="status" className={cn(FEEDBACK_LINE, "text-text-2")}>
              <FeedbackIcon tone="info" text="停止已受理，当前条目完成后停下" />
              <span className="@max-[663px]/lbctx:hidden">
                停止已受理，当前条目完成后停下
              </span>
            </span>
          )}
          {/* 进度环已撤：「在跑」的进度只由选择器 chip 内的 14px 状态图标
              表达，这里的文本是本组唯一的信息载体——字色取正文级 --text-2（⑤）。
              让位秩序（§22 .lb-sbstat）：本行先让、floor 4em、放不下走省略号兜底，
              极窄档（≤512）数字 ≥1000 先改 X.Xk 缩写——两式同场按容器宽互斥显隐，
              三个数都不到千位时缩写与原样同字，只留一份。 */}
          <span className="min-w-[4em] overflow-hidden text-ellipsis whitespace-nowrap text-t-sm tabular-nums text-text-2">
            {attempted >= 1000 || planned >= 1000 || failed >= 1000 ? (
              <>
                <span className="@max-[512px]/lbctx:hidden">
                  {progressText(attempted, planned, failed)}
                </span>
                <span className="hidden @max-[512px]/lbctx:inline">
                  {`${kCount(attempted)} / ${kCount(planned)} · 失败 ${kCount(failed)}`}
                </span>
              </>
            ) : (
              progressText(attempted, planned, failed)
            )}
          </span>
          {/* 飞行期只失效不换装：aria-disabled＋掐点击，外观同形。
              等条目窗口内本钮保持可点（③：可重复唤起弹窗改选「立即中断」）。 */}
          <Button
            variant="destructive-soft"
            size="sm"
            aria-disabled={busy || undefined}
            className="flex-none aria-disabled:pointer-events-none"
            data-testid="run-stop"
            onClick={() => {
              if (busy) return;
              setStopDialog(true);
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
            className="flex-none aria-disabled:pointer-events-none"
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
          {/* 禁用必须说明原因（按钮规范）；飞行期只失效不换装。 */}
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
              className="flex-none aria-disabled:pointer-events-none"
              onClick={() => {
                if (busy || reconnecting || !known) return;
                void start("full");
              }}
            >
              开始打标
            </Button>
          </Tip>
        </>
      )}
      {stopDialog && (
        // 停止确认弹窗（稿「运行状态组」格 17）：两行动题、无取消项——Esc 与右上角 × 就是
        // 「不停、照常跑」；「立即中断」取红字描边档居左、「确认」（等条目打完）在右位。
        // 默认焦点落右位主行动（格 17 同笔：族规「危险右位」不适用）——否则 Radix 聚焦
        // 页脚首个可聚焦件＝左位「立即中断」，键盘用户回车即触发危险档、与稿意图相反。
        <DialogShell
          open
          onOpenChange={(value) => !value && setStopDialog(false)}
          title="停止跑批？"
          description="当前条目正在生成中，是否等待条目完成后中断？"
          initialFocus="confirm"
          cancel={{
            label: "立即中断",
            variant: "danger-text",
            onClick: () => void stop("immediate"),
          }}
          confirm={{ label: "确认", onClick: () => void stop("graceful") }}
        />
      )}
    </section>
  );
}
