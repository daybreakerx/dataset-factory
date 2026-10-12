import { RefreshCwIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError, api, type TaskView } from "../../../api";
import { DialogShell } from "../../../components/dialog-shell";
import { FormError } from "../../../components/form-error";
import { Button } from "../../../components/ui/button";
import { DialogTitle } from "../../../components/ui/dialog";
import { Tip } from "../../../components/ui/tooltip";
import { reportError } from "../../../lib/feedback";
import { toast } from "../../../lib/toast";

interface Props {
  wid: string;
  /** 标题行右侧真值路径槽（稿撤死文案副题）。 */
  workdirPath: string;
  onClose: () => void;
  onRebuilt: () => void;
  /** 飞行期关窗：句柄交宿主，由宿主轮询到终态后自动重扫（宿主联动⑩）。 */
  onBackground: (taskId: string) => void;
}

/** 轮询失败两档：连接类走浮层＋页脚「重新查询」，非连接类落就地红字＋句末刷新钮。 */
type PollFailure = "none" | "network" | "http";

/**
 * 「重建导入记录」窗：按工作目录现状补一条原地导入记录。
 *
 * 结果态退役（2026-10-11 走查裁）——成功即自动关窗、汇报走浮层；飞行期可关（关掉的是界面、
 * 任务照跑，句柄交宿主）；本页无百分比（后端 rebuild 任务体不回报进度，维持无百分比）。
 */
export function RebuildImportsDialog({
  wid,
  workdirPath,
  onClose,
  onRebuilt,
  onBackground,
}: Props) {
  const [task, setTask] = useState<TaskView | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [pollFailure, setPollFailure] = useState<PollFailure>("none");
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const submittingRef = useRef(false);
  const rebuiltRef = useRef(onRebuilt);
  rebuiltRef.current = onRebuilt;
  const backgroundRef = useRef(onBackground);
  backgroundRef.current = onBackground;
  const latest = useRef<TaskView | null>(null);
  const taskId = task?.id;
  const taskStatus = task?.status;
  const busy = submitting || taskStatus === "running";

  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: retry explicitly restarts observation of the same task.
  useEffect(() => {
    if (!taskId || taskStatus !== "running") return;
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const id = taskId;
    setPollFailure("none");
    async function poll() {
      try {
        const view = await api.getTask(id);
        if (!current) return;
        if (view.id !== id) throw new Error("任务响应与当前重建不一致");
        latest.current = view;
        setTask(view);
        if (view.status === "running") {
          timer = setTimeout(() => void poll(), 2000);
          return;
        }
        rebuiltRef.current();
        const result: unknown = view.result;
        const count =
          typeof result === "object" &&
          result !== null &&
          "file_count" in result &&
          typeof result.file_count === "number"
            ? result.file_count
            : null;
        if (view.status === "succeeded") {
          if (count === null) {
            setError("重建结果格式异常，请重新校验");
            return;
          }
          toast(`重建完成 · 登记素材 ${count} 条`);
          onClose();
          return;
        }
        setError(
          view.error || (view.status === "cancelled" ? "重建已取消" : "重建失败"),
        );
      } catch (reason) {
        if (!current) return;
        if (reason instanceof ApiError && reason.status === 404) {
          setTask(null);
          setError("任务已丢失，请重试");
          rebuiltRef.current();
          return;
        }
        const inline = reportError(reason);
        if (inline === null) {
          setPollFailure("network");
          return;
        }
        setError(`进度查询失败——${inline}；任务可能仍在运行，请稍后重试。`);
        setPollFailure("http");
      }
    }
    void poll();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [taskId, taskStatus, retry, onClose]);

  async function submit() {
    if (busy || submittingRef.current) return;
    submittingRef.current = true;
    const version = generation.current;
    setSubmitting(true);
    setError("");
    try {
      const accepted = await api.rebuildImportRecords(wid);
      if (version !== generation.current) return;
      const started: TaskView = {
        id: accepted.task_id,
        status: "running",
        progress: 0,
        result: null,
        error: null,
      };
      latest.current = started;
      setTask(started);
    } catch (reason) {
      if (version === generation.current) setError(reportError(reason) ?? "");
    } finally {
      submittingRef.current = false;
      if (version === generation.current) setSubmitting(false);
    }
  }

  function leave() {
    // 退出 ≠ 取消任务：关掉界面，重建照跑完，句柄交宿主轮询、完成即自动重扫。
    if (latest.current?.status === "running") {
      toast("重建任务正在后台进行中");
      backgroundRef.current(latest.current.id);
    }
    onClose();
  }

  return (
    <DialogShell
      open
      onOpenChange={(open) => !open && leave()}
      className="max-h-[90dvh] w-[min(var(--w-modal-540),calc(100vw-48px))] max-w-none gap-0 overflow-y-auto p-4"
      footLine
      footer={
        <>
          {busy && (
            <span
              role="status"
              className="mr-auto flex items-center gap-2 self-center text-t-md text-info-ink"
            >
              <span
                aria-hidden="true"
                className="inline-block size-[13px] animate-spin rounded-full border-2 border-n-300 border-t-info-ink"
              />
              正在重建
            </span>
          )}
          <Button variant="secondary" disabled={busy} onClick={leave}>
            取消
          </Button>
          {busy ? (
            pollFailure === "network" ? (
              <Button
                variant="secondary"
                onClick={() => setRetry((value) => value + 1)}
              >
                重新查询
              </Button>
            ) : (
              <Button variant="default" disabled>
                重建导入记录
              </Button>
            )
          ) : (
            <Button onClick={() => void submit()}>重建导入记录</Button>
          )}
        </>
      }
    >
      {/* 头行＝§13 .wdd-head：标题贴左、真值路径槽同行右侧（单行省略、悬停给全文）。 */}
      <div className="mb-2 flex items-baseline gap-3 pr-[42px]">
        <DialogTitle className="shrink-0">重建导入记录</DialogTitle>
        <Tip label={workdirPath}>
          <span className="min-w-0 truncate text-t-sm text-muted-foreground">
            {workdirPath}
          </span>
        </Tip>
      </div>
      <p className="text-t-sm text-warn-ink">
        将以原地导入形式为当前工作目录重建导入记录
      </p>
      {pollFailure === "http" && error ? (
        <div className="mt-3 flex items-center gap-2">
          <FormError className="min-w-0 text-t-sm text-bad-ink">{error}</FormError>
          <Tip label="重新查询">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="重新查询"
              className="shrink-0"
              onClick={() => {
                setError("");
                setRetry((value) => value + 1);
              }}
            >
              <RefreshCwIcon />
            </Button>
          </Tip>
        </div>
      ) : (
        error && <FormError className="mt-3 text-t-sm text-bad-ink">{error}</FormError>
      )}
    </DialogShell>
  );
}
