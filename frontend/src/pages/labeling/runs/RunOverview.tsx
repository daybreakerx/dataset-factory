import { CheckIcon, CopyIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../../api";
import type { components } from "../../../api-types.gen";
import { FormError } from "../../../components/form-error";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Tip } from "../../../components/ui/tooltip";
import { reportError } from "../../../lib/feedback";
import { formatDuration } from "../../../lib/format";
import { useLatestRun } from "./use-latest-run";

type RunLogTab = "run.log" | "items.jsonl";

interface Props {
  wid: string;
  batch: string;
  refreshKey: unknown;
  fallback: { total: number; done: number; failed: number };
}

/** items.jsonl 单行事件里「逐条流水」表格用得到的字段；未知字段忽略。 */
interface ItemRunRecord {
  item: string;
  status: string;
  attempt?: number;
  elapsed_ms?: number;
  asset_hash?: string;
  message?: string;
}

/** 日志展示口径：尾部 200 行、最新在最上（原型定案，说明行同步告知）。 */
const LOG_TAIL_LINES = 200;

function parseItemRecords(text: string): ItemRunRecord[] {
  const records: ItemRunRecord[] = [];
  for (const line of text.replace(/\n$/, "").split("\n")) {
    if (!line.trim()) continue;
    try {
      const raw = JSON.parse(line) as Record<string, unknown>;
      if (typeof raw.item === "string" && typeof raw.status === "string") {
        records.push({
          item: raw.item,
          status: raw.status,
          attempt: typeof raw.attempt === "number" ? raw.attempt : undefined,
          elapsed_ms: typeof raw.elapsed_ms === "number" ? raw.elapsed_ms : undefined,
          asset_hash: typeof raw.asset_hash === "string" ? raw.asset_hash : undefined,
          message: typeof raw.message === "string" ? raw.message : undefined,
        });
      }
    } catch {
      // 残缺行跳过：逐条流水只是给人看的视图，不参与判定。
    }
  }
  return records;
}

/** 每个条目取最新一条记录，返回顺序 = 最新处理的条目在前。 */
function latestByItem(records: ItemRunRecord[]): ItemRunRecord[] {
  const byItem = new Map<string, ItemRunRecord>();
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record && !byItem.has(record.item)) byItem.set(record.item, record);
  }
  return [...byItem.values()];
}

function formatElapsed(ms: number | undefined): string {
  // V4：人读时长统一走 formatDuration（几分几秒，不靠小数秒）。
  return ms === undefined ? "—" : formatDuration(ms);
}

function RunLogDialog({
  wid,
  batch,
  runId,
  onClose,
}: {
  wid: string;
  batch: string;
  runId: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<RunLogTab>("run.log");
  const [result, setResult] = useState<components["schemas"]["RunTextView"] | null>(
    null,
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [copyState, setCopyState] = useState<"ok" | "fail" | null>(null);
  // 刷新在飞（非首读）：页脚两钮同禁，Esc 与关闭钮一并拦住（③⑫，快照弹窗同构）。
  const refreshing = loading && revision > 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision explicitly reloads the selected tab.
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    api
      .readRunText(wid, batch, runId, tab)
      .then((value) => {
        if (current) setResult(value);
      })
      .catch((reason) => {
        if (!current) return;
        // ⑪ 环境类（连不上／超时）走全局浮层、不落就地红字；其余用后端真话就地给。
        const inline = reportError(reason);
        if (inline !== null) setError(inline);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [wid, batch, runId, tab, revision]);
  const lines = useMemo(
    () => (result?.text ? result.text.replace(/\n$/, "").split("\n") : []),
    [result],
  );
  const displayText = useMemo(
    () => lines.slice(-LOG_TAIL_LINES).reverse().join("\n"),
    [lines],
  );
  const itemRows = useMemo(
    () =>
      tab === "items.jsonl" ? latestByItem(parseItemRecords(result?.text ?? "")) : null,
    [tab, result],
  );
  // ②③ 复制钮禁用四态：读取中／读取失败／空态（有读数但无正文）／刷新在飞；Tip 随态三说（④）。
  const emptyContent = result !== null && result.text.trim() === "";
  const copyDisabled = loading || error !== "" || result === null || emptyContent;
  const copyLabel =
    copyState === "ok"
      ? "已复制"
      : copyState === "fail"
        ? "复制失败，请检查剪贴板权限"
        : "复制";
  const copyTip =
    error !== ""
      ? "读取失败，请先刷新"
      : loading
        ? "正在读取"
        : emptyContent
          ? "暂无记录，没有可复制的内容"
          : copyLabel;
  const copy = async () => {
    const text =
      tab === "run.log"
        ? displayText
        : [
            ["素材", "状态", "尝试", "耗时", "素材哈希", "说明"].join("\t"),
            ...(itemRows ?? []).map((row) =>
              [
                row.item,
                row.status === "succeeded" ? "成功" : "失败",
                row.attempt ?? "—",
                formatElapsed(row.elapsed_ms),
                row.asset_hash ? `${row.asset_hash.slice(0, 6)}…` : "—",
                row.message || "—",
              ].join("\t"),
            ),
          ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("ok");
    } catch {
      setCopyState("fail");
    }
    window.setTimeout(() => setCopyState(null), 1500);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !refreshing) onClose();
      }}
    >
      <DialogContent
        className="grid-cols-[minmax(0,1fr)] max-h-[90dvh] w-[min(var(--w-modal-780),100%)] max-w-none overflow-y-auto"
        onEscapeKeyDown={(event) => refreshing && event.preventDefault()}
        onInteractOutside={(event) => refreshing && event.preventDefault()}
      >
        <DialogHeader className="flex-row items-center gap-3 space-y-0">
          <DialogTitle className="shrink-0">运行日志</DialogTitle>
          {/* 分段控件＝§12 .seg／.seg-item 族（①）：容器 2px 缝＋内距、钮 --h-sm 档、选中白底＋sh-1。 */}
          <div
            role="tablist"
            aria-label="日志视图"
            className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-muted p-0.5"
          >
            {(
              [
                ["run.log", "运行日志"],
                ["items.jsonl", "逐条流水"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                className={`h-(--h-sm) rounded-md px-3 text-t-sm ${
                  tab === value
                    ? "bg-card font-medium text-text-1 shadow-(--sh-1)"
                    : "text-text-3"
                }`}
                onClick={() => setTab(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <Tip label={result?.path ?? runId}>
            <DialogDescription className="min-w-0 flex-1 truncate">
              {result?.path ?? runId}
            </DialogDescription>
          </Tip>
        </DialogHeader>
        {error && <FormError className="text-bad-ink">{error}</FormError>}
        {tab === "run.log" ? (
          // 日志块＝§29 .log-box.log-box--wrap 族（⑧：底色改画布底、折行 anywhere）；限高 384 属件级。
          <pre
            data-testid="run-log-body"
            className="max-h-96 overflow-auto rounded-md bg-background p-3 font-sans text-t-sm leading-(--lh-base) text-text-2 whitespace-pre-wrap break-anywhere"
          >
            {result ? displayText || "暂无记录" : "正在读取"}
          </pre>
        ) : (
          <div className="max-h-96 overflow-auto rounded-md border border-border">
            {/* 流水表＝§11 .table 族（⑨：表头吸顶 30 高／muted 底／text-3，行分隔改 border-bottom，td 32 定高）。 */}
            <table className="w-full border-collapse text-t-sm">
              <thead>
                <tr>
                  {["素材", "状态", "尝试", "耗时", "素材哈希", "说明"].map((label) => (
                    <th
                      key={label}
                      className="sticky top-0 z-(--z-sticky) h-(--h-md) border-b border-border bg-muted px-3 text-left font-medium text-text-3 whitespace-nowrap"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {itemRows?.length ? (
                  itemRows.map((row) => (
                    <tr key={row.item}>
                      <td className="h-8 border-b border-border px-3 break-all text-text-2">
                        {row.item}
                      </td>
                      <td className="h-8 border-b border-border px-3 text-text-2">
                        <span
                          className={
                            row.status === "succeeded" ? "text-ok-ink" : "text-bad-ink"
                          }
                        >
                          {row.status === "succeeded" ? "成功" : "失败"}
                        </span>
                      </td>
                      <td className="h-8 border-b border-border px-3 text-text-2 tabular-nums">
                        {row.attempt ?? "—"}
                      </td>
                      <td className="h-8 border-b border-border px-3 text-text-2 tabular-nums">
                        {formatElapsed(row.elapsed_ms)}
                      </td>
                      <td className="h-8 border-b border-border px-3 text-text-2 tabular-nums">
                        {/* ⑩ 截断的哈希悬停给全文（DESIGN.md 六）。 */}
                        {row.asset_hash ? (
                          <Tip label={row.asset_hash}>
                            <span className="block truncate">
                              {`${row.asset_hash.slice(0, 6)}…`}
                            </span>
                          </Tip>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="h-8 max-w-60 border-b border-border px-3 text-text-2">
                        <Tip label={row.message || ""}>
                          <span className="block truncate">{row.message || "—"}</span>
                        </Tip>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={6}
                      className="h-8 border-b border-border px-3 text-center text-text-3"
                    >
                      {result ? "暂无记录" : "正在读取"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-end gap-2">
          {/* ④ 复制反馈＝钮本体换装（对勾／红叉），文字行退役；②③ 未就绪与刷新在飞都禁用。 */}
          <Tip label={copyTip}>
            <Button
              variant="ghost"
              size="icon"
              aria-label={copyLabel}
              disabled={copyDisabled || refreshing}
              onClick={() => void copy()}
            >
              {copyState === "ok" ? (
                <CheckIcon />
              ) : copyState === "fail" ? (
                <XIcon className="text-bad-ink" />
              ) : (
                <CopyIcon />
              )}
            </Button>
          </Tip>
          <Tip label="刷新最新日志">
            <Button
              variant="ghost"
              size="icon"
              aria-label="刷新"
              disabled={refreshing}
              onClick={() => setRevision((value) => value + 1)}
            >
              <RefreshCwIcon />
            </Button>
          </Tip>
          <Button variant="secondary" onClick={onClose}>
            关闭
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function RunOverview({ wid, batch, refreshKey, fallback }: Props) {
  const [log, setLog] = useState<{ runId: string } | null>(null);
  // 换批次清空磁盘摘要时联动清掉上一批选中的日志弹窗（联动口在 use-latest-run）。
  const clearLog = useCallback(() => setLog(null), []);
  const { history, error, setRevision } = useLatestRun(
    wid,
    batch,
    refreshKey,
    clearLog,
  );
  const record = history?.record;
  const counts = record
    ? {
        total: record.counters.attempted + record.counters.skipped,
        done: record.counters.succeeded,
        failed: record.counters.failed,
      }
    : fallback;
  const elapsed = record?.finished_at
    ? Math.max(
        0,
        (Date.parse(record.finished_at) - Date.parse(record.started_at)) / 1000,
      )
    : null;
  const startedText = new Date(record?.started_at ?? 0).toLocaleString();
  const endedText = record?.finished_at
    ? new Date(record.finished_at).toLocaleTimeString()
    : "正在跑批";
  const elapsedText =
    elapsed === null ? "" : ` · 耗时 ${formatDuration(elapsed * 1000)}`;
  return (
    <section aria-label={record ? "本次运行" : "条目汇总"}>
      {/* 分区头（稿「标题行与运行统计」格 1／5／6）：题＋错误行（紧跟题右 12px、不占满剩余）
          ＋时间行（可截断，悬停给完整起止与耗时）＋查看日志钮右置。 */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h3 className="shrink-0 text-t-md font-medium">
          {record ? "本次运行" : "条目汇总"}
        </h3>
        {error && (
          <>
            <span role="alert" className="min-w-0 truncate text-t-sm text-bad-ink">
              {error}
            </span>
            <Tip label="重新查询">
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="重新查询"
                onClick={() => setRevision((value) => value + 1)}
              >
                <RefreshCwIcon />
              </Button>
            </Tip>
          </>
        )}
        {record && (
          <>
            <Tip label={`${startedText} → ${endedText}${elapsedText}`}>
              <span className="min-w-0 flex-1 truncate text-t-xs text-text-4">
                {startedText} → {endedText}
                {elapsedText}
              </span>
            </Tip>
            <Button
              className="ml-auto shrink-0"
              variant="ghost"
              size="sm"
              onClick={() => setLog({ runId: record.run_id })}
            >
              查看日志
            </Button>
          </>
        )}
      </div>
      <dl className="grid max-w-115 grid-cols-3 gap-3">
        {[
          ["总数", counts.total],
          [record ? "成功" : "已完成", counts.done],
          ["未完成", counts.failed],
        ].map(([label, count]) => (
          <div key={label} className="rounded-lg border border-border bg-card p-3">
            <dt className="text-t-sm text-muted-foreground">{label}</dt>
            <dd
              className={`mt-1 text-t-2xl leading-(--lh-tight) font-medium tabular-nums ${label === "未完成" && count !== 0 ? "text-bad-ink" : "text-text-1"}`}
            >
              {count}
            </dd>
          </div>
        ))}
      </dl>
      {log && (
        <RunLogDialog
          key={`${wid}/${batch}/${log.runId}`}
          wid={wid}
          batch={batch}
          runId={log.runId}
          onClose={() => setLog(null)}
        />
      )}
    </section>
  );
}
