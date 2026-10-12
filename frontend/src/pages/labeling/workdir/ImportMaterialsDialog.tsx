import { FolderIcon, RefreshCwIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { ApiError, api, errorMessage, type TaskView } from "../../../api";
import { DirectoryPicker } from "../../../components/DirectoryPicker";
import { DialogShell } from "../../../components/dialog-shell";
import { FormError } from "../../../components/form-error";
import { Button } from "../../../components/ui/button";
import { DialogTitle } from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Tip } from "../../../components/ui/tooltip";
import { reportError } from "../../../lib/feedback";
import { toast } from "../../../lib/toast";
import { type ImportReport, parseImportReport } from "../runs/import-report";

type Mode = "copy" | "inplace";

/** 就地导入只登记白名单内、未超限、未登记的在盘文件——后端按这三个原因分档。 */
const REASON_UNREGISTERED = "未登记";

/** 复制形态的来源扫描：结果只属于扫描那一刻的来源值，来源一改即作废回「待扫描」（稿格 2）。 */
type Scan =
  | { state: "idle" }
  | { state: "scanning" }
  | { state: "done"; source: string; names: string[] }
  | { state: "failed"; source: string; message: string };

/** 就地形态的「可导入的文件」：弹窗自查（2026-10-11 裁·与目录选择弹窗／重建弹窗同法）。 */
type Inplace =
  | { state: "loading" }
  | { state: "ready"; names: string[] }
  | { state: "failed"; message: string };

/** 轮询失败两档：连接类走全局浮层＋页脚「重新查询」，非连接类落就地红字＋句末刷新钮（稿格 13／16）。 */
type PollFailure = "none" | "network" | "http";

/** 跳过类汇报的名单档：最多列两项文件名，多则尾缀「等 N 项」（稿「完成汇报」四条模板）。 */
function skipLine(prefix: string, names: string[]): string {
  if (names.length <= 2) return `${prefix}${names.join("、")}`;
  return `${prefix}${names.slice(0, 2).join("、")} 等 ${names.length} 项`;
}

/**
 * 完成汇报逐条浮现（结果卡 2026-10-10 整块退役，汇报改浮层）。
 *
 * 顺序与稿一致：完成 → 完全相同 → 同名异容 → 异名同容 → 不支持；各自独立不合并、只给结果不给出口。
 */
function reportCompletion(report: ImportReport): void {
  toast(`导入完成 · 新增 ${report.imported.length} 项`);
  const groups: [string, string[]][] = [
    ["已跳过完全相同的文件：", report.skipped_identical],
    [
      "已跳过文件名相同但内容不同的文件：",
      report.skipped_conflict.map((row) => row.name),
    ],
    [
      "已跳过内容相同但文件名不同的文件：",
      report.skipped_duplicate.map((row) => row.name),
    ],
    ["已跳过不支持的文件：", report.rejected.map((row) => row.name)],
  ];
  for (const [prefix, names] of groups) {
    if (names.length > 0) toast(skipLine(prefix, names));
  }
}

/**
 * 「导入素材」窗：往已登记的工作目录增量导入素材，两形态由入参定默认档。
 *
 * 就地导入＝素材已在目录内、只登记不搬文件；复制导入＝填来源、点「扫描」列出这次会导入
 * 的文件，再点「导入」。结果卡退役后完成即自动关窗，汇报走浮层。
 */
export function ImportMaterialsDialog({
  wid,
  workdirPath,
  onClose,
  onImported,
  initialMode = "inplace",
  initialSource = "",
}: {
  wid: string;
  /** 标题行右侧真值路径槽（稿撤死文案副题，2026-10-10 格 1 裁）。 */
  workdirPath: string;
  onClose: () => void;
  onImported: () => void;
  initialMode?: Mode;
  initialSource?: string;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [source, setSource] = useState(initialSource);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [scan, setScan] = useState<Scan>({ state: "idle" });
  const [inplace, setInplace] = useState<Inplace>({ state: "loading" });
  const [task, setTask] = useState<TaskView | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [pollFailure, setPollFailure] = useState<PollFailure>("none");
  const [checking, setChecking] = useState(0);
  const sourceId = useId();
  const generation = useRef(0);
  const submittingRef = useRef(false);
  const importedRef = useRef(onImported);
  importedRef.current = onImported;

  const trimmed = source.trim();
  const running = task?.status === "running";
  const active = submitting || running;
  const taskId = task?.id;
  const taskStatus = task?.status;
  // 来源改动即作废扫描结果（稿格 2「改动来源后扫描结果作废回待扫描」）。
  const scanned: Scan =
    (scan.state === "done" || scan.state === "failed") && scan.source !== trimmed
      ? { state: "idle" }
      : scan;
  const listNames =
    mode === "copy"
      ? scanned.state === "done"
        ? scanned.names
        : null
      : inplace.state === "ready"
        ? inplace.names
        : null;
  const scanMessage =
    mode === "copy" && scanned.state === "failed" ? scanned.message : "";
  const readMessage =
    mode === "inplace" && inplace.state === "failed" ? inplace.message : "";
  // 正文只有一个红字槽：扫描失败句随来源改动自动作废（走 derived 的 scanned），读取失败句
  // 与提交／轮询失败句不会同时在场，按顺序取第一条。
  const visibleError = scanMessage || readMessage || error;

  useEffect(() => {
    generation.current += 1;
    return () => {
      generation.current += 1;
    };
  }, []);

  const loadInplace = useCallback(async () => {
    const token = generation.current;
    setInplace({ state: "loading" });
    try {
      const view = await api.scanPreview(wid);
      if (token !== generation.current) return;
      setInplace({
        state: "ready",
        names: view.unimported
          .filter((item) => item.reason === REASON_UNREGISTERED)
          .map((item) => item.name),
      });
    } catch (reason) {
      if (token === generation.current) {
        setInplace({ state: "failed", message: errorMessage(reason) });
      }
    }
  }, [wid]);

  // 就地形态的清单由本窗自取（打开即取、切回本形态重取）；复制形态的来源扫描是手动事件。
  useEffect(() => {
    if (mode === "inplace") void loadInplace();
  }, [mode, loadInplace]);

  // checking 表示用户显式重查，进度变化不重新建立轮询。
  // biome-ignore lint/correctness/useExhaustiveDependencies: checking is the explicit retry trigger.
  useEffect(() => {
    if (!taskId || taskStatus !== "running") return;
    const id = taskId;
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setPollFailure("none");
    async function poll() {
      try {
        const view = await api.getTask(id);
        if (!current) return;
        if (view.id !== id) throw new Error("导入任务响应与当前导入不一致");
        setTask(view);
        if (view.status === "running") {
          timer = setTimeout(() => void poll(), 2000);
          return;
        }
        setCancelling(false);
        setPollFailure("none");
        importedRef.current();
        if (view.status === "succeeded") {
          try {
            reportCompletion(parseImportReport(view.result));
          } catch (reason) {
            setError(errorMessage(reason));
            return;
          }
          onClose();
          return;
        }
        setError(
          view.error || (view.status === "cancelled" ? "导入已取消" : "导入失败"),
        );
      } catch (reason) {
        if (!current) return;
        if (reason instanceof ApiError && reason.status === 404) {
          setTask(null);
          setCancelling(false);
          setPollFailure("none");
          setError("任务进度丢失，请重新执行导入");
          importedRef.current();
          return;
        }
        // 连接类只报浮层、句柄留着等用户「重新查询」；后端答错了的红字才落在正文槽。
        const inline = reportError(reason);
        if (inline === null) {
          setPollFailure("network");
          return;
        }
        setError(inline);
        setPollFailure("http");
      }
    }
    void poll();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [taskId, taskStatus, checking, onClose]);

  async function runScan() {
    if (active || trimmed === "") return;
    setScan({ state: "scanning" });
    setError("");
    try {
      const view = await api.importPreview(wid, trimmed);
      setScan({ state: "done", source: trimmed, names: view.files.map((f) => f.name) });
    } catch (reason) {
      const inline = reportError(reason);
      setScan(
        inline === null
          ? { state: "idle" }
          : { state: "failed", source: trimmed, message: inline },
      );
    }
  }

  async function submit() {
    if (active || submittingRef.current) return;
    if (mode === "copy" && (scanned.state !== "done" || scanned.names.length === 0)) {
      return;
    }
    if (
      mode === "inplace" &&
      !(inplace.state === "ready" && inplace.names.length > 0)
    ) {
      return;
    }
    submittingRef.current = true;
    const token = generation.current;
    setSubmitting(true);
    setError("");
    try {
      const accepted = await api.importMaterials(wid, {
        source: mode === "copy" ? trimmed : null,
      });
      if (token !== generation.current) return;
      if (!accepted.task_id?.trim()) throw new Error("导入任务编号无效");
      setTask({
        id: accepted.task_id,
        status: "running",
        progress: 0,
        result: null,
        error: null,
      });
    } catch (reason) {
      if (token === generation.current) {
        setError(reportError(reason) ?? "");
      }
    } finally {
      submittingRef.current = false;
      if (token === generation.current) setSubmitting(false);
    }
  }

  async function cancel() {
    if (!task || cancelling || submitting) return;
    setCancelling(true);
    try {
      await api.cancelTask(task.id);
      setChecking((value) => value + 1);
    } catch (reason) {
      setCancelling(false);
      setError(reportError(reason) ?? "");
    }
  }

  function chooseMode(next: Mode) {
    if (active) return;
    setMode(next);
    setError("");
  }

  const isScanning = scanned.state === "scanning";
  const readFailed = mode === "inplace" && inplace.state === "failed";
  const primaryLabel = mode === "copy" && scanned.state !== "done" ? "扫描" : "导入";
  const primaryAction = primaryLabel === "扫描" ? runScan : submit;
  const primaryDisabled =
    mode === "copy"
      ? scanned.state === "idle"
        ? trimmed === ""
        : scanned.state === "done" && scanned.names.length === 0
      : !(inplace.state === "ready" && inplace.names.length > 0);

  // 页脚右位（稿格 1~16）：飞行期＝取消导入（连接类失败换装「重新查询」）；
  // 就地读取失败＝「重新读取」；其余＝主钮两身份（未扫描／失败「扫描」，有结果「导入」）。
  let footerAction: ReactNode;
  if (active) {
    footerAction =
      pollFailure === "network" ? (
        <Button variant="secondary" onClick={() => setChecking((value) => value + 1)}>
          重新查询
        </Button>
      ) : (
        <Button
          variant="secondary"
          aria-disabled={cancelling || submitting || undefined}
          className="aria-disabled:pointer-events-none"
          onClick={() => void cancel()}
        >
          取消导入
        </Button>
      );
  } else if (readFailed) {
    footerAction = (
      <Button variant="secondary" onClick={() => void loadInplace()}>
        重新读取
      </Button>
    );
  } else {
    footerAction = (
      <Tip
        label={
          mode === "copy" && scanned.state === "idle" && trimmed === ""
            ? "先选好来源，再扫描"
            : ""
        }
      >
        <Button
          disabled={primaryDisabled}
          aria-disabled={isScanning || undefined}
          className={isScanning ? "pointer-events-none" : undefined}
          onClick={() => void primaryAction()}
        >
          {primaryLabel}
        </Button>
      </Tip>
    );
  }

  if (pickerOpen) {
    // 稿格 10「本窗换装」：来源行文件夹钮把本窗换成目录选择弹窗，单层流转不叠窗。
    return (
      <DirectoryPicker
        initialPath={trimmed}
        files
        allowCreate
        allowRename
        onClose={() => setPickerOpen(false)}
        onSelect={(path) => {
          setSource(path);
          setScan({ state: "idle" });
          setPickerOpen(false);
        }}
      />
    );
  }

  return (
    <DialogShell
      open
      // 退出 ≠ 撤销：飞行期关掉的是界面，导入任务照常跑完（稿格 11／13／16 同口径）。
      onOpenChange={(open) => !open && onClose()}
      className="max-h-[90dvh] w-[min(var(--w-modal-560),calc(100vw-48px))] gap-0 overflow-y-auto"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            关闭
          </Button>
          {footerAction}
        </>
      }
    >
      {/* 头行＝§13 .wdd-head（标题 flex:none＋副题槽贴标题右侧、baseline）；路径槽被截断时给全文。 */}
      <div className="mb-2 flex items-baseline gap-3 pr-[42px]">
        <DialogTitle className="shrink-0">导入素材</DialogTitle>
        <Tip label={workdirPath}>
          <span className="min-w-0 truncate text-t-sm text-muted-foreground">
            {workdirPath}
          </span>
        </Tip>
      </div>
      {/* 方式选择器＝§12 .seg；飞行期只失效不换装（行为冻结、视觉同形）。 */}
      <div
        role="tablist"
        aria-label="导入方式"
        aria-disabled={active || undefined}
        className="aria-disabled:pointer-events-none inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5"
      >
        {(
          [
            ["inplace", "就地导入"],
            ["copy", "复制导入"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            className={`h-(--h-sm) rounded-sm px-3 text-t-sm ${
              mode === value
                ? "bg-card font-medium text-text-1 shadow-(--sh-1)"
                : "text-text-3"
            }`}
            onClick={() => chooseMode(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "copy" && (
        <div className="mt-3">
          <label
            htmlFor={sourceId}
            className="mb-1 block text-t-md font-medium text-text-1"
          >
            来源
          </label>
          <div className="flex items-center gap-2">
            <Input
              id={sourceId}
              value={source}
              readOnly={active}
              className="min-w-0 flex-1"
              onChange={(event) => setSource(event.currentTarget.value)}
            />
            <Tip label="选择来源">
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                aria-label="选择来源"
                aria-disabled={active || undefined}
                className="shrink-0 aria-disabled:pointer-events-none"
                onClick={() => !active && setPickerOpen(true)}
              >
                <FolderIcon />
              </Button>
            </Tip>
          </div>
        </div>
      )}
      {isScanning && (
        <p role="status" className="mt-3 text-t-sm text-text-4">
          正在扫描…
        </p>
      )}
      {mode === "inplace" && inplace.state === "loading" && (
        <p role="status" className="mt-3 text-t-sm text-text-4">
          正在读取…
        </p>
      )}
      {listNames !== null && (
        <div className="mt-3 max-h-64 overflow-y-auto rounded-md border border-border px-3 py-1">
          {listNames.length === 0 ? (
            <p className="px-2 py-4 text-center text-t-sm text-text-3">
              没有可以导入的文件
            </p>
          ) : (
            listNames.map((name) => (
              <span key={name} className="block break-all py-1 text-t-sm text-text-1">
                {name}
              </span>
            ))
          )}
        </div>
      )}
      {running && pollFailure === "none" && (
        <p role="status" className="my-2 text-t-sm text-info-ink tabular-nums">
          {cancelling ? "正在取消" : "正在导入"} ·{" "}
          {Math.round((task?.progress ?? 0) * 100)}%
        </p>
      )}
      {pollFailure === "http" && error ? (
        // 非连接类失败：红字句末挂刷新钮（§13 .wdd-errow），取消仍可达（链路没断）。
        <div className="mb-4 mt-3 flex items-center gap-2">
          <FormError className="min-w-0 text-t-sm text-bad-ink">
            {visibleError}
          </FormError>
          <Tip label="重新查询">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="重新查询"
              className="shrink-0"
              onClick={() => {
                setError("");
                setChecking((value) => value + 1);
              }}
            >
              <RefreshCwIcon />
            </Button>
          </Tip>
        </div>
      ) : visibleError ? (
        <FormError className="my-3 text-t-sm text-bad-ink">{visibleError}</FormError>
      ) : null}
    </DialogShell>
  );
}
