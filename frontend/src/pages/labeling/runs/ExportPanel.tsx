import {
  ArrowRightIcon,
  ChevronDownIcon,
  DownloadIcon,
  PackageIcon,
  SquareIcon,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api, errorMessage } from "../../../api";
import type { components } from "../../../api-types.gen";
import { FormError } from "../../../components/form-error";
import { Button } from "../../../components/ui/button";
import { Switch } from "../../../components/ui/switch";
import { Tip } from "../../../components/ui/tooltip";
import { formatBytes } from "../../../lib/format";
import { registerInPlace, reimportFromSource } from "../material-actions";
import { useExportFlow } from "./use-export-flow";

type Row = components["schemas"]["ExportPlanRow"];

/**
 * 被排除行的处置出口（四类）：缺失〔重新导入／重新指定〕· 未导入〔导入〕·
 * 未完成〔加入重试〕· 用户排除〔撤销排除〕。
 *
 * 「素材不可读取」已并入「缺失」，「无配对产物」「产物异常」两类由后端撤出本清单
 * （家在左列「排队中」）；其余原因（如配对冲突）本波不给出口，随各窗对齐条另落。
 */
function disposalOf(row: Row): {
  label: string;
  kind: "undo" | "run" | "repoint";
  enabled: boolean;
  hint?: string;
} | null {
  const reason = row.reason ?? "";
  if (reason === "用户排除") return { label: "撤销排除", kind: "undo", enabled: true };
  if (reason === "缺失")
    return row.recoverable
      ? { label: "重新导入", kind: "run", enabled: true }
      : { label: "重新指定", kind: "repoint", enabled: true };
  if (reason === "未完成") return { label: "加入重试", kind: "run", enabled: true };
  if (reason === "未登记") return { label: "导入", kind: "run", enabled: true };
  if (reason === "扩展名不支持" || reason.startsWith("超出大小上限"))
    return { label: "导入", kind: "run", enabled: false, hint: reason };
  return null;
}

/** 被排除原因的界面措辞：机制常量不动，只动呈现（2026-10-10 用户裁）。 */
function packReason(reason: string | null | undefined): string {
  if (reason === "未登记") return "未导入";
  if (reason === "未完成") return "未完成，打标失败";
  return reason ?? "";
}

interface Props {
  wid: string;
  batch: string;
  refreshKey: unknown;
  /** 缺失行「重新指定」：目录选择弹窗由页面挂载，这里只把文件名交出去。 */
  onRepoint?: (name: string) => void;
  /** 「加入重试」成功后回灌左列重试名单——与左列「加入重试」共用同一套行为。 */
  onRetryChanged?: (items: string[]) => void;
  /**
   * 发车前摘要的媒体维度（V5）：plan 响应里没有图片 / 视频计数（契约如此），
   * 这些只能由父组件从条目列表与完整性报告汇出后传入——export/plan 不为此扩契约。
   */
  mediaSummary?: {
    images: number;
    videos: number;
    changed: number;
  };
}

function ExportList({
  rows,
  excluded,
  busy,
  busyRow,
  onChange,
  onDispose,
  onRepoint,
}: {
  rows: Row[];
  excluded: boolean;
  busy: boolean;
  /** 正在处置的那一行的文件名——同一清单里其余行的动作暂失效（不并发动盘）。 */
  busyRow: string | null;
  onChange: (items: string[], excluded: boolean) => Promise<boolean>;
  onDispose: (row: Row) => Promise<void>;
  onRepoint?: (name: string) => void;
}) {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(false);
  const eligible = rows.filter((row) => !excluded || row.reason === "用户排除");
  const chosen = eligible
    .filter((row) => selected.has(row.item))
    .map((row) => row.item);
  const visible = expanded || selecting ? rows : rows.slice(0, 10);
  async function change(items: string[]) {
    if (await onChange(items, !excluded)) {
      setSelected(new Set());
      setSelecting(false);
    }
  }
  return (
    <section
      aria-label={excluded ? "被排除清单" : "将入包清单"}
      className={excluded ? "mt-2 border-t border-dashed border-border pt-2" : ""}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2 text-t-sm text-text-3">
        <span>
          {excluded ? "被排除" : "将入包"} {rows.length} 条
        </span>
        <div className="ml-auto flex items-center gap-2">
          {selecting && (
            <>
              <span className="tabular-nums">已选 {chosen.length}</span>
              <Button
                variant="ghost"
                size="mini"
                disabled={busy}
                onClick={() =>
                  setSelected(
                    new Set(
                      chosen.length === eligible.length
                        ? []
                        : eligible.map((row) => row.item),
                    ),
                  )
                }
              >
                {/* L10：随态换文案（与打标页左列同一口径）。 */}
                {chosen.length === eligible.length ? "清空本组" : "全选"}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                disabled={busy || !chosen.length}
                onClick={() => void change(chosen)}
              >
                {excluded ? "撤销排除" : "排除选中的"}
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="xs"
            disabled={busy || !eligible.length}
            onClick={() => {
              setSelecting(!selecting);
              setSelected(new Set());
            }}
          >
            {selecting ? "退出选择" : "选择"}
          </Button>
        </div>
      </div>
      <ul className="space-y-1 text-t-sm text-text-3">
        {visible.map((row) => {
          const act = excluded ? disposalOf(row) : null;
          return (
            <li
              key={`${row.item}/${row.name}`}
              className="flex min-w-0 flex-wrap items-center gap-2"
            >
              {selecting && (!excluded || row.reason === "用户排除") && (
                <input
                  type="checkbox"
                  className="cb"
                  aria-label={`选择 ${row.name}`}
                  disabled={busy}
                  checked={selected.has(row.item)}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setSelected((old) => {
                      const next = new Set(old);
                      if (checked) next.add(row.item);
                      else next.delete(row.item);
                      return next;
                    });
                  }}
                />
              )}
              <span className="break-all">{row.name}</span>
              {excluded ? (
                <>
                  <span className="text-bad-ink">{packReason(row.reason)}</span>
                  {act && (
                    <Tip label={act.hint}>
                      <Button
                        className="ml-auto"
                        variant="ghost"
                        size="xs"
                        disabled={
                          busy ||
                          !act.enabled ||
                          (busyRow !== null && busyRow !== row.name)
                        }
                        onClick={() => {
                          if (act.kind === "undo") void change([row.item]);
                          else if (act.kind === "repoint") onRepoint?.(row.name);
                          else void onDispose(row);
                        }}
                      >
                        {act.label}
                      </Button>
                    </Tip>
                  )}
                </>
              ) : (
                <>
                  <ArrowRightIcon
                    aria-hidden="true"
                    className="size-3 shrink-0 text-text-4"
                  />
                  <span className="break-all">
                    {row.asset_name} + {row.caption_name}
                  </span>
                  {row.integrity === "changed" && (
                    <span className="text-warn-ink">打标后素材已变更</span>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
      {rows.length > 10 && !selecting && (
        <Button
          variant="ghost"
          size="mini"
          className="mt-1"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "收起" : `展开全部 ${rows.length} 条`}
        </Button>
      )}
    </section>
  );
}

export function ExportPanel({
  wid,
  batch,
  refreshKey,
  onRepoint,
  onRetryChanged,
  mediaSummary,
}: Props) {
  const sequentialId = useId();
  const [expanded, setExpanded] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const cancelPending = useRef(false);
  const generation = useRef(0);
  const pending = useRef(false);
  // 换批次时命令域的随行复位：由 useExportFlow 的身份复位 effect 统一联动
  // （先于计划重取，次序同拆分前）；卸载时的代次失效由下方独立清理承担。
  const onIdentityReset = useCallback(() => {
    generation.current += 1;
    pending.current = false;
    setBusy(false);
    setCancelling(false);
    setCancelRequested(false);
    setCancelError("");
    cancelPending.current = false;
  }, []);
  const {
    plan,
    loading,
    planError,
    sequential,
    setSequential,
    setRevision,
    task,
    setTask,
    download,
    setDownload,
    pollFailed,
    setPollRevision,
    error,
    setError,
  } = useExportFlow(wid, batch, refreshKey, onIdentityReset);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const taskId = task?.id;
  const taskStatus = task?.status;
  const currentTask = useRef(task);
  currentTask.current = task;
  const locked = busy || taskStatus === "running";

  // 卸载时使在途命令的代次护栏失效（身份变更路径的失效在 onIdentityReset 内）。
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  async function exclusions(items: string[], excluded: boolean) {
    if (pending.current || locked) return false;
    const version = generation.current;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await api.setExclusions(wid, batch, items, excluded);
      if (version !== generation.current) return false;
      setDownload(null);
      setRevision((value) => value + 1);
      return true;
    } catch (reason) {
      if (version === generation.current) setError(errorMessage(reason));
      return false;
    } finally {
      if (version === generation.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }

  /**
   * 被排除行的处置：与左列条目行走同一套后端动作（2026-10-10 用户裁「取消独立的重打
   * 逻辑，全都复用加入重试的行为」的同族口径）。成功后重取计划——该行可能迁入将入包。
   */
  async function disposeRow(row: Row) {
    if (busyRow || locked || loading) return;
    setBusyRow(row.name);
    setError("");
    try {
      if (row.reason === "未完成") {
        const result = await api.addRetryItems(wid, batch, [row.item]);
        onRetryChanged?.(Array.from(result.items ?? []));
      } else if (row.reason === "缺失") {
        await reimportFromSource(wid, row.name);
      } else {
        await registerInPlace(wid, row.name);
      }
      setRevision((value) => value + 1);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyRow(null);
    }
  }

  async function start() {
    if (pending.current || locked || loading || !plan?.included.length) return;
    const version = generation.current;
    pending.current = true;
    setBusy(true);
    setError("");
    setDownload(null);
    setCancelRequested(false);
    setCancelError("");
    try {
      const accepted = await api.startExport(wid, batch, sequential);
      if (!accepted || typeof accepted.task_id !== "string" || !accepted.task_id.trim())
        throw new Error("导出任务编号无效");
      if (version === generation.current)
        setTask({
          id: accepted.task_id,
          status: "running",
          progress: 0,
          result: null,
          error: null,
        });
    } catch (reason) {
      if (version === generation.current) setError(errorMessage(reason));
    } finally {
      if (version === generation.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }

  async function cancel() {
    if (!taskId || taskStatus !== "running" || cancelPending.current || cancelRequested)
      return;
    const version = generation.current;
    const id = taskId;
    cancelPending.current = true;
    setCancelling(true);
    setCancelError("");
    try {
      await api.cancelTask(id);
      if (
        version !== generation.current ||
        currentTask.current?.id !== id ||
        currentTask.current.status !== "running"
      )
        return;
      setCancelRequested(true);
      setError("");
      setPollRevision((value) => value + 1);
    } catch (reason) {
      if (
        version === generation.current &&
        currentTask.current?.id === id &&
        currentTask.current.status === "running"
      )
        setCancelError(errorMessage(reason));
    } finally {
      if (version === generation.current) {
        cancelPending.current = false;
        setCancelling(false);
      }
    }
  }

  return (
    <section aria-label="打包与导出" className="mt-4 border-t border-border pt-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          size="xs"
          aria-label="折叠或展开打包清单"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronDownIcon className={expanded ? "" : "-rotate-90"} />
        </Button>
        <h3 className="text-t-md font-medium">打包与导出</h3>
        {plan && (
          <span className="ml-auto text-t-xs text-text-4 tabular-nums">
            {/* V5（2026-09-21 审计）：发车前最该核对的维度一次给全——
                将入包 N 条 · 图片 N · 视频 N · 含变更素材 N · 共 X MB。 */}
            {[
              `${plan.included.length} 条`,
              mediaSummary !== undefined
                ? `图片 ${mediaSummary.images} · 视频 ${mediaSummary.videos} · 含变更素材 ${mediaSummary.changed}`
                : null,
              formatBytes(plan.total_bytes, "MB", 2),
            ]
              .filter((part) => part !== null)
              .join(" · ")}
          </span>
        )}
      </div>
      {planError && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <FormError className="text-t-sm text-bad-ink">{planError}</FormError>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setRevision((value) => value + 1)}
          >
            重查导出计划
          </Button>
        </div>
      )}
      {error && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <FormError className="text-t-sm text-bad-ink">{error}</FormError>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setError("");
              if (pollFailed && taskStatus === "running")
                setPollRevision((value) => value + 1);
              else setRevision((value) => value + 1);
            }}
          >
            重新查询
          </Button>
        </div>
      )}
      {expanded && (
        <div aria-busy={loading}>
          <label
            htmlFor={sequentialId}
            className="mb-2 flex items-center justify-between gap-2 text-t-sm text-text-3"
          >
            顺序重命名（001 起 · 3 位定宽）
            <Switch
              id={sequentialId}
              aria-label="顺序重命名"
              checked={sequential}
              disabled={locked}
              onCheckedChange={(checked) => {
                setSequential(checked);
                setDownload(null);
              }}
            />
          </label>
          {loading && (
            <p role="status" className="text-t-sm text-text-4">
              正在计算导出计划
            </p>
          )}
          {!sequential && plan?.non_ascii_names && (
            <p className="mb-2 text-t-sm text-warn-ink">
              文件名含非 ASCII 字符，跨平台解压可能导致素材与 txt 配对失败。
            </p>
          )}
          <div hidden={!plan || loading}>
            <ExportList
              key={`${wid}/${batch}/included`}
              rows={plan?.included ?? []}
              excluded={false}
              busy={locked || loading}
              busyRow={busyRow}
              onChange={exclusions}
              onDispose={disposeRow}
            />
            <ExportList
              key={`${wid}/${batch}/excluded`}
              rows={plan?.excluded ?? []}
              excluded
              busy={locked || loading}
              busyRow={busyRow}
              onChange={exclusions}
              onDispose={disposeRow}
              onRepoint={onRepoint}
            />
          </div>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          disabled={locked || loading || !!error || !plan?.included.length}
          onClick={() => void start()}
        >
          <PackageIcon />
          导出当前策略
        </Button>
        {taskStatus === "running" && (
          <>
            <span role="status" className="text-t-sm text-text-3">
              {cancelRequested ? "正在取消" : "正在打包"} ·{" "}
              {Math.round((task?.progress ?? 0) * 100)}%
            </span>
            <Button
              variant="ghost"
              size="xs"
              disabled={cancelling || cancelRequested}
              onClick={() => void cancel()}
            >
              <SquareIcon />
              取消导出
            </Button>
            {cancelError && (
              <FormError className="text-t-sm text-bad-ink">{cancelError}</FormError>
            )}
          </>
        )}
        {download && (
          <>
            <a
              href={download.url}
              download
              className="inline-flex items-center gap-2 text-t-sm text-text-2 underline"
            >
              <DownloadIcon className="size-(--icon-md)" />
              下载 ZIP
            </a>
            <span className="min-w-0 break-all text-t-xs text-text-4">
              {download.path}
            </span>
          </>
        )}
      </div>
    </section>
  );
}
