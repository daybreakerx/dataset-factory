/** 服务 · 运行日志（单列整面板：头行＝四态状态行＋级别筛选＋刷新图标钮；下接日志框）。 */

import { RefreshCwIcon } from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ServiceLogs } from "../../../api";
import { api } from "../../../api";
import {
  type ServiceProbeState,
  serviceDotClass,
  useServiceProbe,
} from "../../../app-shell/service-dot";
import { Button } from "../../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { Tip } from "../../../components/ui/tooltip";
import { useVscrollColumn } from "../../../components/vscroll";
import { reportError } from "../../../lib/feedback";

/** 日志级别筛选四档（纯前端过滤、不发请求；刷新后筛选保持）。 */
type LogFilter = "all" | "info" | "warn" | "bad";

const FILTER_OPTIONS: ReadonlyArray<{ value: LogFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "info", label: "信息" },
  { value: "warn", label: "警告" },
  { value: "bad", label: "报错" },
];

/** 按行解析级别词：WARNING→warn、ERROR/CRITICAL→bad、INFO 及其余→info（导出供单测）。 */
export function parseLogLevel(line: string): Exclude<LogFilter, "all"> {
  if (/\b(ERROR|CRITICAL)\b/.test(line)) return "bad";
  if (/\bWARNING\b/.test(line)) return "warn";
  return "info";
}

/** 状态行文案（四态与版本行点的 Tip 同源——同态同话；bad 文字跟点同档转红）。 */
function statusTitle(state: ServiceProbeState): string {
  return state === "ok"
    ? "服务运行中"
    : state === "bad"
      ? "服务不可用"
      : state === "stopping"
        ? "正在停止服务"
        : "正在检测服务";
}

/** 时长格式＝「N 小时 M 分」（零件稿 服务状态行 口径），随 30 秒轮询重算。 */
function formatDuration(startedAt: string, now: number): string {
  const start = new Date(startedAt).getTime();
  const totalMinutes = Number.isNaN(start)
    ? 0
    : Math.max(0, Math.floor((now - start) / 60_000));
  return `${Math.floor(totalMinutes / 60)} 小时 ${totalMinutes % 60} 分`;
}

/** 「信息／警告／报错」档筛空时的定制空态文案。 */
const FILTER_EMPTY: Record<Exclude<LogFilter, "all">, string> = {
  info: "没有信息日志",
  warn: "没有警告日志",
  bad: "没有报错日志",
};

export function ServicePanel(): ReactElement {
  // 状态行：四态探测状态机与数据（30 秒常驻轮询＝已运行时长的重算节拍）。
  const { state, status } = useServiceProbe();
  // 日志区：独立取数、三态分脸，与状态行互不联动。
  const [logs, setLogs] = useState<ServiceLogs | null>(null);
  const [logsError, setLogsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const loadingRef = useRef(false);
  const [filter, setFilter] = useState<LogFilter>("all");
  // 时长的时钟节拍：轮询重算之外，本组件再挂一分钟的秒级 tick 不必要——
  // 轮询每 30 秒拉回新 status 对象即触发重算，够用且与探测同拍。
  const logBoxRef = useVscrollColumn<HTMLDivElement>();

  const reloadLogs = useCallback(async (): Promise<void> => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      setLogs(await api.getServiceLogs());
      setLogsError(false);
    } catch (err) {
      // 失败分流＝只接非连接类进三态（连接类走浮层）；后端原文不进界面。
      setLogsError(reportError(err) !== null);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadLogs();
  }, [reloadLogs]);

  // 日志倒序（最新在顶）：tail 文件序正序 → 分行反转；pos＝文件行号，作渲染 key
  // （日志常见完全相同的两行，内容不能当 key）。
  const lines: { text: string; pos: number }[] = [];
  if (logs?.exists && logs.content !== "") {
    const rows = logs.content
      .replace(/\n$/, "")
      .split("\n")
      .map((text, pos) => ({ text, pos }))
      .reverse();
    lines.push(...rows);
  }
  const visible =
    filter === "all"
      ? lines
      : lines.filter((line) => parseLogLevel(line.text) === filter);
  const showMeta = status !== null && (state === "ok" || state === "stopping");

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-2 rounded-lg border border-border bg-card p-4 shadow-(--sh-1)">
      <div className="flex min-h-(--h-lg) items-center gap-3">
        <span
          aria-hidden
          className={`inline-block size-1.5 shrink-0 rounded-full ${serviceDotClass(state)}`}
        />
        <span
          className={`min-w-0 truncate text-t-md font-medium ${state === "bad" ? "text-bad-ink" : "text-text-1"}`}
        >
          {statusTitle(state)}
        </span>
        {showMeta && (
          <span className="flex-none text-t-sm text-text-3">
            监听 {status.host}:{status.port} · 已运行{" "}
            {formatDuration(status.started_at, Date.now())}
          </span>
        )}
        <Select value={filter} onValueChange={(value) => setFilter(value as LogFilter)}>
          <SelectTrigger aria-label="日志级别" className="ml-auto w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTER_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Tip label="刷新">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="刷新"
            // 刷新飞行＝瞬态只失效不换装（重入由 loadingRef 守卫掐住）。
            aria-disabled={loading || undefined}
            onClick={() => void reloadLogs()}
          >
            <RefreshCwIcon />
          </Button>
        </Tip>
      </div>
      <div
        ref={logBoxRef}
        className="vscroll-y min-h-0 flex-1 overflow-auto rounded-md bg-background p-3 font-sans text-t-sm leading-(--lh-loose) whitespace-pre text-text-2"
      >
        {logsError ? (
          <span className="text-text-3">日志读取失败</span>
        ) : loading && logs === null ? (
          <span className="text-text-3">正在读取…</span>
        ) : logs !== null && !logs.exists ? (
          <span className="text-text-3">暂无日志</span>
        ) : visible.length === 0 ? (
          <span className="text-text-3">
            {filter === "all" ? "暂无日志" : FILTER_EMPTY[filter]}
          </span>
        ) : (
          visible.map((entry) => {
            const level = parseLogLevel(entry.text);
            return (
              <span
                key={entry.pos}
                className={
                  level === "warn"
                    ? "text-warn-ink"
                    : level === "bad"
                      ? "text-bad-ink"
                      : undefined
                }
              >
                {entry.text}
                {"\n"}
              </span>
            );
          })
        )}
      </div>
    </div>
  );
}
