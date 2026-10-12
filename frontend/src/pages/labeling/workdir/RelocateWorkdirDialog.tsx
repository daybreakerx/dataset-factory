import { useEffect, useRef, useState } from "react";
import { ApiError, api, errorMessage, type TaskView } from "../../../api";
import type { components } from "../../../api-types.gen";
import { DirectoryPicker } from "../../../components/DirectoryPicker";
import { DialogShell } from "../../../components/dialog-shell";
import { FormError } from "../../../components/form-error";
import { Button } from "../../../components/ui/button";
import { DialogTitle } from "../../../components/ui/dialog";

type RelocationRecord = components["schemas"]["WorkdirRelocationStatus"];
type Evidence = components["schemas"]["WorkdirRelocationEvidence"];
type Result = { path: string; old_path: string; cleanup_pending: boolean };
/** 二次确认的三种去向（稿格 12／14／16——同一弹窗原地换内容，不新开窗）。 */
type Confirming = "abandon-copy" | "abandon-switchover" | "delete-old";

/** 琥珀句（稿 .modal-head-note--warn）：本件定制，全程常驻。 */
const HEAD_WARN = "迁移后原目录将删除。";

function parseResult(value: unknown): Result {
  if (
    !value ||
    typeof value !== "object" ||
    !("path" in value) ||
    typeof value.path !== "string" ||
    !("old_path" in value) ||
    typeof value.old_path !== "string" ||
    !("cleanup_pending" in value) ||
    typeof value.cleanup_pending !== "boolean"
  )
    throw new Error("迁移结果格式无效");
  return {
    path: value.path,
    old_path: value.old_path,
    cleanup_pending: value.cleanup_pending,
  };
}

/** 一次只处置一条记录：混杂时先认还能推进的两类（④类只在盘上核不对时兜底）。 */
function pickRecord(records: RelocationRecord[]): RelocationRecord | null {
  return (
    records.find((item) => item.status !== "location-changed") ?? records[0] ?? null
  );
}

export function RelocateWorkdirDialog({
  wid,
  source,
  records,
  onClose,
  onChanged,
  onRunningChange,
}: {
  wid: string;
  source: string;
  /** 宿主路径行取来的未结清迁移记录；空＝常态，打开即浏览选目标（稿格 8 是唯一入口）。 */
  records: RelocationRecord[];
  onClose: () => void;
  onChanged: () => void;
  /** 迁移在飞时回报宿主：路径行那条链接挂 .is-flight（只失效不换装，稿格 11）。 */
  onRunningChange: (running: boolean) => void;
}) {
  const [task, setTask] = useState<TaskView | null>(null);
  const [target, setTarget] = useState("");
  const [resuming, setResuming] = useState(false);
  const [record, setRecord] = useState<RelocationRecord | null>(pickRecord(records));
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [done, setDone] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const accepting = useRef(false);
  const cancelPending = useRef(false);
  const currentTask = useRef(task);
  currentTask.current = task;
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const notify = useRef(onRunningChange);
  notify.current = onRunningChange;
  const taskId = task?.id;
  const status = task?.status;
  const isRunning = status === "running";

  useEffect(() => {
    generation.current += 1;
    return () => {
      generation.current += 1;
    };
  }, []);

  useEffect(() => {
    notify.current(isRunning);
  }, [isRunning]);

  useEffect(
    () => () => {
      notify.current(false);
    },
    [],
  );

  // 宿主重取到的记录优先；正处置着（受理在飞／已有现场）时不被一次空取打回浏览态。
  useEffect(() => {
    const next = pickRecord(records);
    if (next) {
      setRecord(next);
      return;
    }
    if (!accepting.current && !cancelPending.current && currentTask.current === null)
      setRecord(null);
  }, [records]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision rechecks the existing task, not a new relocation.
  useEffect(() => {
    if (!taskId || status !== "running") return;
    const id = taskId;
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const view = await api.getTask(id);
        if (!current) return;
        if (view.id !== id) throw new Error("任务响应与当前迁移不一致");
        setError("");
        setTask(view);
        if (view.status === "running") {
          timer = setTimeout(() => void poll(), 2000);
          return;
        }
        setCancelRequested(false);
        if (view.status === "succeeded") {
          const value = parseResult(view.result);
          if (value.cleanup_pending) {
            // 复制与切换都成了，只差旧目录没删掉——落③类待处置（稿格 13）。
            setRecord({
              old_path: value.old_path,
              path: value.path,
              status: "cleanup-pending",
            });
            setEvidence(null);
          } else {
            setRecord(null);
            setDone(`已迁移到 ${value.path}，原目录已删除。`);
          }
        } else {
          if (view.status === "cancelled") {
            // 取消＝②类残留：副本在盘、注册表没动——按这次发起的落点直接进处置视图。
            setRecord({ old_path: source, path: target, status: "copy-retained" });
          }
          setError(
            view.error || (view.status === "cancelled" ? "迁移已取消" : "迁移失败"),
          );
        }
        changed.current();
      } catch (reason) {
        if (!current) return;
        if (reason instanceof ApiError && reason.status === 404) {
          setTask(null);
          setError("上次任务已丢失（服务重启过），按盘上记录继续处置");
          changed.current();
        } else {
          // 连不上后端这类环境失败：报一句、下一轮照常再问。
          setError(errorMessage(reason));
          timer = setTimeout(() => void poll(), 2000);
        }
      }
    }
    void poll();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [taskId, status, revision]);

  // ③类处置要看「旧目录被动过没有、新目录能不能退」——随视图取一次证。
  useEffect(() => {
    if (record?.status !== "cleanup-pending" || evidence) return;
    let current = true;
    void api.relocationEvidence(wid, record.old_path).then(
      (value) => {
        if (current) setEvidence(value);
      },
      () => {
        // 取不到证就按最宽松的形态画：两钮都在，真判据由后端在按钮背后把关。
        if (current)
          setEvidence({
            old_present: true,
            old_changed: false,
            old_replaced: false,
            target_in_use: false,
          });
      },
    );
    return () => {
      current = false;
    };
  }, [record, evidence, wid]);

  async function start(path: string, resume: boolean) {
    if (accepting.current || isRunning || busy) return;
    const token = generation.current;
    accepting.current = true;
    setError("");
    setCancelRequested(false);
    setTarget(path);
    setResuming(resume);
    try {
      const accepted = await api.relocateWorkdir(wid, path);
      if (token !== generation.current) return;
      if (!accepted.task_id?.trim()) throw new Error("迁移任务编号无效");
      setTask({
        id: accepted.task_id,
        status: "running",
        progress: 0,
        error: null,
        result: null,
      });
    } catch (reason) {
      if (token === generation.current) setError(errorMessage(reason));
    } finally {
      accepting.current = false;
    }
  }

  async function cancel() {
    if (!taskId || status !== "running" || cancelPending.current || cancelRequested)
      return;
    const token = generation.current;
    const id = taskId;
    cancelPending.current = true;
    try {
      await api.cancelTask(id);
      if (
        token === generation.current &&
        currentTask.current?.id === id &&
        currentTask.current.status === "running"
      ) {
        setCancelRequested(true);
        // 立刻再问一次，不等两秒的轮询节拍——取消的终态就是界面的下一步。
        setRevision((value) => value + 1);
      }
    } catch (reason) {
      if (token === generation.current && currentTask.current?.status === "running")
        setError(errorMessage(reason));
    } finally {
      cancelPending.current = false;
    }
  }

  /** 三条不可恢复处置：②删副本、③退回原位置、③删旧目录。 */
  async function dispose(action: Confirming) {
    if (busy || !record) return;
    const token = generation.current;
    const migrated = record.path;
    setBusy(true);
    setError("");
    try {
      if (action === "abandon-copy") {
        await api.abandonCopy(wid, record.path);
      } else if (action === "abandon-switchover") {
        await api.abandonSwitchover(wid, record.old_path);
      } else {
        const result = await api.retryRelocationCleanup(
          wid,
          record.old_path,
          evidence?.old_changed === true || evidence?.old_replaced === true,
        );
        if (result.cleanup_pending) {
          setError("旧目录还被占用，没能删除，请稍后重试。");
          setConfirming(null);
          return;
        }
        setDone(`已迁移到 ${migrated}，原目录已删除。`);
      }
      setRecord(null);
      setConfirming(null);
      changed.current();
      // 放弃类处置做完已无现场可看，关窗回常态（稿格 12／14）；删旧留下结果句（格 16）。
      if (action !== "delete-old") onClose();
    } catch (reason) {
      if (token === generation.current) {
        setError(errorMessage(reason));
        setConfirming(null);
      }
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }

  const title =
    confirming === "delete-old"
      ? "删除旧目录？"
      : confirming
        ? "放弃迁移？"
        : "修改路径";
  const hostPath = record?.status === "cleanup-pending" ? record.path : source;
  const footClass = "mt-4 flex flex-wrap items-center justify-end gap-3";

  if (!isRunning && !done && !record) {
    return (
      <DirectoryPicker
        initialPath={source}
        allowCreate
        allowRename
        requireEmptyTarget
        titleText="修改路径"
        hostText={`当前：${source}`}
        headWarn={HEAD_WARN}
        primaryLabel="迁移到此目录"
        bodyError={error}
        onClose={onClose}
        onSelect={(path) => void start(path, false)}
      />
    );
  }

  return (
    <DialogShell
      open
      // 族口径「退出 ≠ 撤销」：关的是弹窗，后台迁移照跑（路径行接管进度，稿格 11）。
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className="w-[min(var(--w-modal-620),calc(100vw-48px))] gap-0 p-4"
    >
      <div className="mb-2 flex flex-wrap items-center gap-3 pr-8">
        <DialogTitle className="text-t-xl font-medium">{title}</DialogTitle>
        <span className="min-w-0 break-all text-t-sm text-text-3">
          当前：{hostPath}
        </span>
        <span className="min-w-0 flex-1 text-t-sm text-warn-ink">{HEAD_WARN}</span>
      </div>

      {isRunning ? (
        <>
          <p role="status" className="break-all text-t-sm text-text-3">
            {resuming ? `继续迁移到 ${target}` : `迁移到 ${target}`}
          </p>
          <p role="status" className="mt-2 text-t-sm text-info-ink tabular-nums">
            {resuming ? "正在校验并切换" : "正在复制并校验"} ·{" "}
            {Math.round((task?.progress ?? 0) * 100)}%
          </p>
        </>
      ) : done ? (
        <p role="status" className="break-all text-t-sm text-text-3">
          {done}
        </p>
      ) : confirming === "abandon-copy" && record ? (
        <p className="break-all text-t-sm text-warn-ink">
          将删除未完成副本 {record.path}，并保留现位置 {record.old_path}{" "}
          不变。副本删除后不可恢复。
        </p>
      ) : confirming === "abandon-switchover" && record ? (
        <p className="break-all text-t-sm text-warn-ink">
          将会删除新目录 {record.path}，并退回原位置 {record.old_path}。删除后不可恢复。
        </p>
      ) : confirming === "delete-old" && record ? (
        <p className="break-all text-t-sm text-warn-ink">
          {evidence?.old_replaced
            ? `旧目录 ${record.old_path} 此路径已不是当初那个旧目录，删除后不可恢复。`
            : `旧目录 ${record.old_path} 里有迁移后变更或新增的内容，删除后不可恢复。`}
        </p>
      ) : record?.status === "copy-retained" ? (
        <p role="status" className="break-all text-t-sm text-text-3">
          上次迁移未完成：已复制到 {record.path}，但还没有切换过去。
        </p>
      ) : record?.status === "cleanup-pending" ? (
        <>
          <p role="status" className="break-all text-t-sm text-text-3">
            已迁移到 {record.path}；旧目录 {record.old_path} 尚未删除。
          </p>
          {!evidence && (
            <p role="status" className="mt-2 text-t-sm text-text-4">
              正在核对目录现状…
            </p>
          )}
          {evidence?.target_in_use && (
            <p className="mt-2 text-t-sm text-text-3">新目录已开始运行，不可删除。</p>
          )}
        </>
      ) : (
        // ④类：记录与盘上对不上（新设计不再产生，只有历史遗留会落到这里）——不给自动处置。
        <p className="break-all text-t-sm text-text-3">
          上次迁移记录与工作目录现状对不上，请在盘上核对后刷新本页。
        </p>
      )}

      {error && (
        <FormError className="mt-2 break-all text-t-sm text-bad-ink">{error}</FormError>
      )}

      {isRunning && (
        <div className={footClass}>
          {/* 飞行期「取消」只失效不换装；退出走关闭钮与 Esc（稿格 6／10）。 */}
          <Button
            variant="secondary"
            aria-disabled="true"
            className="pointer-events-none"
          >
            取消
          </Button>
          {resuming ? (
            <Button aria-disabled="true" className="pointer-events-none">
              继续迁移
            </Button>
          ) : (
            <Button
              variant="secondary"
              disabled={cancelRequested}
              onClick={() => void cancel()}
            >
              {cancelRequested ? "正在取消" : "取消迁移"}
            </Button>
          )}
        </div>
      )}
      {!isRunning &&
        !confirming &&
        (done || !record || record.status === "location-changed") && (
          <div className={footClass}>
            <Button variant="secondary" onClick={onClose}>
              关闭
            </Button>
          </div>
        )}
      {!isRunning && !done && !confirming && record?.status === "copy-retained" && (
        <div className={footClass}>
          <Button
            variant="danger-text"
            disabled={busy}
            onClick={() => {
              setError("");
              setConfirming("abandon-copy");
            }}
          >
            放弃迁移
          </Button>
          <Button disabled={busy} onClick={() => void start(record.path, true)}>
            继续迁移
          </Button>
        </div>
      )}
      {!isRunning && !done && !confirming && record?.status === "cleanup-pending" && (
        <div className={footClass}>
          {evidence && !evidence.target_in_use && (
            <Button
              variant="danger-text"
              disabled={busy}
              onClick={() => {
                setError("");
                setConfirming("abandon-switchover");
              }}
            >
              放弃迁移
            </Button>
          )}
          <Button
            variant="secondary"
            disabled={busy || !evidence}
            onClick={() => {
              setError("");
              if (evidence && (evidence.old_changed || evidence.old_replaced))
                setConfirming("delete-old");
              else void dispose("delete-old");
            }}
          >
            删除旧目录
          </Button>
        </div>
      )}
      {confirming && (
        <div className={footClass}>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => setConfirming(null)}
          >
            取消
          </Button>
          <Button
            variant={confirming === "delete-old" ? "secondary" : "danger-text"}
            disabled={busy}
            onClick={() => void dispose(confirming)}
          >
            {confirming === "delete-old" ? "删除旧目录" : "确认放弃"}
          </Button>
        </div>
      )}
    </DialogShell>
  );
}
