import {
  ChevronDownIcon,
  DownloadIcon,
  ListChecksIcon,
  PackageIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../api";
import type { components } from "../../../api-types.gen";
import { FormError } from "../../../components/form-error";
import {
  SquareCheckIcon,
  SquareFrameIcon,
  SquareMinusIcon,
  SquareStopIcon,
} from "../../../components/icons";
import { Button, buttonVariants } from "../../../components/ui/button";
import { Switch } from "../../../components/ui/switch";
import { Tip } from "../../../components/ui/tooltip";
import { formatBytes } from "../../../lib/format";
import { cn } from "../../../lib/utils";
import { registerInPlace, reimportFromSource } from "../material-actions";
import { JournalCorruptedLine } from "./journal-corrupted-line";
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
   * 这些只能由父组件从条目列表汇出后传入——export/plan 不为此扩契约。
   */
  mediaSummary?: {
    images: number;
    videos: number;
  };
}

function ExportList({
  rows,
  excluded,
  sequential,
  busy,
  busyRow,
  onChange,
  onDispose,
  onRepoint,
}: {
  rows: Row[];
  excluded: boolean;
  /** 顺序重命名态：入包行的符号列与归一名段随它换装（①）。 */
  sequential: boolean;
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
  // 全选三态换形（§28 工具组 ②）：满态＝清除选择、半选＝补齐全选、未选＝全选；字色恒 --text-3。
  const allChosen = eligible.length > 0 && chosen.length === eligible.length;
  const selectAllLabel = allChosen
    ? "清除选择"
    : chosen.length
      ? "补齐全选(已部分选中)"
      : "全选";
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
      {/* 清单头＝§28 .pack-head（计数 t-sm/--text-3 等宽）＋右端 .pack-tools（簇内 center、
          「已选 N」撤除、计数并入主动作）。 */}
      <div
        className={cn(
          "flex min-w-0 items-baseline gap-2",
          excluded ? "mb-2" : "mt-3 mb-2",
        )}
      >
        <span className="text-t-sm text-text-3 tabular-nums">
          {excluded ? "被排除" : "将入包"} {rows.length} 条
        </span>
        <div className="ml-auto flex items-center gap-2">
          {selecting && (
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy || !chosen.length}
                onClick={() => void change(chosen)}
              >
                {`${excluded ? "撤销排除" : "排除"}(${chosen.length})`}
              </Button>
              <Tip label={selectAllLabel}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={selectAllLabel}
                  disabled={busy || !eligible.length}
                  onClick={() =>
                    setSelected(
                      allChosen ? new Set() : new Set(eligible.map((row) => row.item)),
                    )
                  }
                >
                  {allChosen ? (
                    <SquareCheckIcon />
                  ) : chosen.length ? (
                    <SquareMinusIcon />
                  ) : (
                    <SquareFrameIcon />
                  )}
                </Button>
              </Tip>
            </>
          )}
          <Tip label={selecting ? "退出选择" : "选择"}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={selecting ? "退出选择" : "选择"}
              disabled={busy || !eligible.length}
              onClick={() => {
                setSelecting(!selecting);
                setSelected(new Set());
              }}
            >
              {selecting ? <XIcon /> : <ListChecksIcon />}
            </Button>
          </Tip>
        </div>
      </div>
      {/* 入包行＝§28 三段 grid（原名｜符号｜归一名段，列宽整份清单统一算、只有原名列可压缩）；
          被排除行不参与该体系，独立 flex「名＋原因＋右钉动作」。 */}
      <ul
        className={
          excluded
            ? "flex min-w-0 flex-col gap-1 text-t-sm text-text-3"
            : cn(
                "grid min-w-0 justify-start gap-x-2 gap-y-1 text-t-sm text-text-3",
                selecting
                  ? "grid-cols-[auto_minmax(0,max-content)_max-content_max-content]"
                  : "grid-cols-[minmax(0,max-content)_max-content_max-content]",
              )
        }
      >
        {visible.map((row) => {
          const act = excluded ? disposalOf(row) : null;
          if (excluded)
            return (
              <li key={row.name} className="flex min-w-0 items-center gap-2">
                {selecting && row.reason === "用户排除" && (
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
                <span className="min-w-0 break-all">{row.name}</span>
                <span className="shrink-0 text-bad-ink">{packReason(row.reason)}</span>
                <span className="min-w-0 flex-1" />
                {act && (
                  <Tip label={act.hint}>
                    <Button
                      variant="ghost"
                      size="sm"
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
              </li>
            );
          return (
            <li key={row.name} className="contents">
              {selecting && (
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
              {/* 压缩与截断只发生在原名列（悬停给全文），归一名段永不压缩、永不折行。 */}
              <Tip label={row.name}>
                <span className="block min-w-0 truncate">{row.name}</span>
              </Tip>
              <span className="whitespace-nowrap text-text-4">
                {sequential ? "→" : "+"}
              </span>
              <span className="whitespace-nowrap">
                {sequential ? (
                  <>
                    {row.asset_name}
                    <span className="text-text-4"> + </span>
                    {row.caption_name}
                  </>
                ) : (
                  row.caption_name
                )}
                {row.integrity === "changed" && (
                  <span className="text-warn-ink"> 打标后素材已变更</span>
                )}
                {/* 关态同名行（仅大小写不同）：仍入包，行内琥珀标记一句即含出路
                    （2026-10-13 稿㉑；文案逐字在稿，开回顺序重命名即消）。 */}
                {row.name_conflict && (
                  <span className="text-warn-ink">
                    {" "}
                    有同名文件(仅大小写不同)，建议开启顺序重命名
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {rows.length > 10 && !selecting && (
        <Button
          variant="ghost"
          size="sm"
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
    planCorruptRun,
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

  // 摘要三段（⑥：图片／视频／体积，「N 条」与「含变更素材 N」撤除）——纯文字读数、并入触发钮。
  const summary = plan
    ? [
        mediaSummary === undefined
          ? null
          : `图片 ${mediaSummary.images} · 视频 ${mediaSummary.videos}`,
        formatBytes(plan.total_bytes, "MB", 2),
      ]
        .filter((part) => part !== null)
        .join(" · ")
    : "";
  const corrupt = planCorruptRun !== null;
  const message = planError || error;
  const refreshLabel = planError || corrupt ? "重查导出计划" : "重新查询";

  function refresh() {
    setError("");
    if (!planError && !corrupt && pollFailed && taskStatus === "running")
      setPollRevision((value) => value + 1);
    else setRevision((value) => value + 1);
  }

  return (
    <section aria-label="打包与导出" className="mt-4 border-t border-border pt-4">
      {/* 分区头＝§25 ov 族（整行折叠触发：chevron＋题＋摘要／加载句／错误句），
          损坏句与刷新钮在触发钮外、句与钮不吃热区（⑦⑧⑰；形态同「素材完整性」分区头）。 */}
      <div className="flex items-baseline gap-3 rounded-md hover:bg-accent">
        <button
          type="button"
          className="flex h-(--h-md) min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronDownIcon
            className={`size-(--icon-xs) shrink-0 text-text-3 ${expanded ? "" : "-rotate-90"}`}
          />
          <span className="shrink-0 text-t-md font-medium">打包与导出</span>
          {loading ? (
            <span role="status" className="shrink-0 text-t-sm text-text-4">
              正在计算导出计划…
            </span>
          ) : (
            plan && (
              <Tip label={summary}>
                <span className="min-w-0 truncate text-t-xs text-text-4 tabular-nums">
                  {summary}
                </span>
              </Tip>
            )
          )}
          {!corrupt && message && (
            <span role="alert" className="min-w-0 truncate text-t-sm text-bad-ink">
              {message}
            </span>
          )}
        </button>
        {corrupt && (
          <JournalCorruptedLine
            className="shrink-0 text-t-sm"
            wid={wid}
            run={planCorruptRun}
            onCleaned={() => setRevision((value) => value + 1)}
          />
        )}
        {corrupt || message ? (
          <Tip label={refreshLabel}>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={refreshLabel}
              className="ml-auto shrink-0"
              onClick={refresh}
            >
              <RefreshCwIcon />
            </Button>
          </Tip>
        ) : null}
      </div>
      {expanded && (
        <div aria-busy={loading}>
          {/* 开关行＝§28 .pack-switchrow：题字｜琥珀警告紧跟题字｜空位｜开关钉右端；
              取数中整行不出（⑤，开关作用于清单、清单未出时无对象），括注已删且不补 Tip（⑭）。 */}
          {!loading && (
            <div className="mt-2 flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-t-sm text-text-3">顺序重命名</span>
              {!sequential && plan?.non_ascii_names && (
                <span className="min-w-0 text-t-sm text-warn-ink">
                  文件名含非 ASCII 字符，跨平台解压可能导致素材与 txt 配对失败。
                </span>
              )}
              <span className="min-w-0 flex-1" />
              <Switch
                className="shrink-0"
                aria-label="顺序重命名"
                checked={sequential}
                disabled={locked}
                onCheckedChange={(checked) => {
                  setSequential(checked);
                  setDownload(null);
                }}
              />
            </div>
          )}
          {/* 重取失败不撤旧读数（稿格 9／10／14），只在首次取数（无旧值）时不出清单。 */}
          <div hidden={!plan}>
            <ExportList
              key={`${wid}/${batch}/included`}
              rows={plan?.included ?? []}
              excluded={false}
              sequential={sequential}
              busy={locked || loading}
              busyRow={busyRow}
              onChange={exclusions}
              onDispose={disposeRow}
            />
            <ExportList
              key={`${wid}/${batch}/excluded`}
              rows={plan?.excluded ?? []}
              excluded
              sequential={sequential}
              busy={locked || loading}
              busyRow={busyRow}
              onChange={exclusions}
              onDispose={disposeRow}
              onRepoint={onRepoint}
            />
          </div>
        </div>
      )}
      {/* 底行＝§28 .pack-acts：nowrap＋钮不缩＋路径吸收收缩；打包中主钮位换「取消导出」、
          进度紧邻其右（⑨⑩）。 */}
      <div className="mt-3 flex min-w-0 items-center gap-3">
        {taskStatus === "running" ? (
          <>
            <Button
              disabled={cancelling || cancelRequested}
              onClick={() => void cancel()}
            >
              <SquareStopIcon />
              取消导出
            </Button>
            <span role="status" className="text-t-sm text-info-ink tabular-nums">
              {cancelRequested ? "正在取消" : "正在打包"} ·{" "}
              {Math.round((task?.progress ?? 0) * 100)}%
            </span>
            {cancelError && (
              <FormError className="text-t-sm text-bad-ink">{cancelError}</FormError>
            )}
          </>
        ) : (
          <Button
            disabled={
              locked ||
              loading ||
              !!error ||
              !!planError ||
              corrupt ||
              !plan?.included.length
            }
            onClick={() => void start()}
          >
            <PackageIcon />
            打包导出
          </Button>
        )}
        {download && (
          <>
            <a
              className={cn(buttonVariants())}
              href={download.url}
              download
              aria-label="下载 ZIP"
            >
              <DownloadIcon />
              下载 ZIP
            </a>
            <Tip label={download.path}>
              <span className="min-w-0 flex-1 truncate text-t-xs text-text-4">
                {download.path}
              </span>
            </Tip>
          </>
        )}
      </div>
    </section>
  );
}
