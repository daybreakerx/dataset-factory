import { ChevronDownIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage, type TaskView } from "../../../api";
import type { components } from "../../../api-types.gen";
import { DialogShell } from "../../../components/dialog-shell";
import { FormError } from "../../../components/form-error";
import { Button } from "../../../components/ui/button";
import { formatBytes } from "../../../lib/format";
import { toast } from "../../../lib/toast";

type Preview = components["schemas"]["CleanupPreview"];
type InvalidFile = components["schemas"]["InvalidFile"];
type GroupKey = "products" | "unsupported" | "oversize";

/** 稿「每标题一表」的三类：标题一行、独立表格一盒，顺序与稿一致。 */
const GROUPS: { key: GroupKey; title: string }[] = [
  { key: "products", title: "无配对产物" },
  { key: "unsupported", title: "不支持的文件" },
  { key: "oversize", title: "超限的文件" },
];

// 清单区限高＝三组可见行合计 9 行（342px＝9×38，表题与组距不占额度；稿八改）。
const ROW_HEIGHT = 38;
const BUDGET_ROWS = 9;

/**
 * 弹性分配（稿八改：短组优先完整 → 剩余由未显完的组平分 → 全都很长则平均分）。
 *
 * 浏览器原生布局给不出这套分配（实测归档见 `components/cleanup-list.md`），故按规则算：
 * 每轮把剩余空间等分给还没分到的组，能整组装下的先完整放行，装不下的那一步就按份额截断
 * ——半行自然裁切，露出的半截即「这里还能滚」的提示。
 */
function allocateRows(counts: number[]): number[] {
  const order = counts
    .map((count, index) => ({ count, index }))
    .filter((group) => group.count > 0)
    .sort((left, right) => left.count - right.count);
  const rows = counts.map(() => 0);
  let remaining = BUDGET_ROWS;
  order.forEach((group, position) => {
    const share = remaining / (order.length - position);
    const given = Math.min(group.count, share);
    rows[group.index] = given;
    remaining -= given;
  });
  return rows;
}

/**
 * 「清理无效文件」清单窗（稿「每标题一表」＋只读扫场）。
 *
 * 选择机制已随只读化退场：清单只给人过目，页脚「全部清理」一步执行（九改撤二次确认），
 * 不可恢复警示常驻标题行右侧红字。清理在飞时清单不退场、折叠仍可用（只失效不换装），
 * 关闭钮与 Esc 照常可退——关掉的是界面，清理照常跑完（2026-10-11 全站口径）。
 */
export function CleanupDialog({
  wid,
  onClose,
  onCleaned,
  onBackground,
}: {
  wid: string;
  onClose: () => void;
  onCleaned: () => void;
  /** 飞行期关窗：把任务句柄交给宿主，由宿主轮询到终态后刷新「清理」行。 */
  onBackground: (taskId: string) => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [task, setTask] = useState<TaskView | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const generation = useRef(0);
  const pending = useRef(false);
  const cleaned = useRef(onCleaned);
  cleaned.current = onCleaned;
  const background = useRef(onBackground);
  background.current = onBackground;
  const latest = useRef<{ task: TaskView | null; loading: boolean }>({
    task: null,
    loading: true,
  });
  latest.current = { task, loading };
  const taskId = task?.id;
  const taskStatus = task?.status;
  const running = taskStatus === "running";
  const busy = submitting || running;

  useEffect(() => {
    generation.current += 1;
    return () => {
      generation.current += 1;
    };
  }, []);

  const load = useCallback(async () => {
    const token = generation.current;
    setLoading(true);
    setError("");
    try {
      const value = await api.previewProductCleanup(wid);
      if (token === generation.current) setPreview(value);
    } catch (reason) {
      if (token === generation.current) setError(errorMessage(reason));
    } finally {
      if (token === generation.current) setLoading(false);
    }
  }, [wid]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!taskId || taskStatus !== "running") return;
    const id = taskId;
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const view = await api.getTask(id);
        if (!current) return;
        if (view.id !== id) throw new Error("任务响应与当前清理不一致");
        setTask(view);
        if (view.status === "running") {
          timer = setTimeout(() => void poll(), 1000);
          return;
        }
        if (view.status === "succeeded") {
          cleaned.current();
          onClose();
        } else {
          setError(
            view.error || (view.status === "cancelled" ? "清理已取消" : "清理失败"),
          );
        }
      } catch (reason) {
        if (!current) return;
        // 查询本身断了：句柄留着，下一轮照常再问（环境类失败不进正文红字）。
        setError(errorMessage(reason));
        timer = setTimeout(() => void poll(), 2000);
      }
    }
    void poll();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [taskId, taskStatus, onClose]);

  const items: InvalidFile[][] = preview
    ? GROUPS.map((group) => preview[group.key])
    : [];
  const visible = items.map((group, index) =>
    collapsed.has(GROUPS[index]?.key ?? "") ? 0 : group.length,
  );
  const budget = allocateRows(visible);

  async function cleanAll() {
    if (pending.current || busy || !preview) return;
    const names = items.flatMap((group) => group.map((item) => item.name));
    if (!names.length) return;
    pending.current = true;
    setSubmitting(true);
    setError("");
    try {
      const accepted = await api.startCleanupInvalid(wid, names);
      if (!accepted.task_id?.trim()) throw new Error("清理任务编号无效");
      setTask({
        id: accepted.task_id,
        status: "running",
        progress: 0,
        error: null,
        result: null,
      });
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  }

  function leave() {
    // 退出 ≠ 撤销：在飞时关掉界面，清理照跑，句柄交宿主轮询、完成即刷新「清理」行。
    if (latest.current.task?.status === "running") {
      toast("清理任务正在后台进行中");
      background.current(latest.current.task.id);
    }
    onClose();
  }

  const hasItems = items.some((group) => group.length > 0);

  return (
    <DialogShell
      open
      onOpenChange={(open) => {
        if (!open) leave();
      }}
      className="max-h-[90dvh] w-[min(var(--w-modal-620),calc(100vw-48px))] gap-0 overflow-y-auto p-4"
      title="清理无效文件"
      hardWarn="清理后不可恢复"
      closeTip={busy ? "关闭不等于撤销删除" : undefined}
      footer={
        <>
          {/* 族口径「退出 ≠ 撤销」：飞行期「取消」只失效不换装，退出走关闭叉与 Esc。 */}
          <Button
            variant="secondary"
            aria-disabled={busy || undefined}
            className={busy ? "pointer-events-none" : undefined}
            onClick={leave}
          >
            取消
          </Button>
          {!loading && !busy && !preview && error && (
            <Button variant="secondary" onClick={() => void load()}>
              重新读取
            </Button>
          )}
          {preview && !busy && (
            <Button
              variant="danger-text"
              disabled={!hasItems}
              onClick={() => void cleanAll()}
            >
              全部清理
            </Button>
          )}
          {busy && (
            <Button
              variant="danger-text"
              aria-disabled="true"
              className="pointer-events-none"
            >
              正在清理
            </Button>
          )}
        </>
      }
    >
      {loading && (
        <p role="status" className="py-3 text-t-sm text-text-4">
          正在读取清单
        </p>
      )}
      {error && <FormError className="py-3 text-t-sm text-bad-ink">{error}</FormError>}
      {running && (
        <p role="status" className="mb-2 text-t-sm text-info-ink tabular-nums">
          正在清理 · {Math.round((task?.progress ?? 0) * 100)}%
        </p>
      )}
      {!loading && preview && !items.some((group) => group.length) && !error && (
        <p className="px-2 py-4 text-t-sm text-text-3">没有可清理的项目</p>
      )}
      {preview &&
        GROUPS.map((group, index) => {
          const rows = preview[group.key];
          if (!rows.length) return null;
          const folded = collapsed.has(group.key);
          const share = budget[index] ?? rows.length;
          const maxHeight =
            rows.length * ROW_HEIGHT > share * ROW_HEIGHT
              ? `${Math.round(share * ROW_HEIGHT)}px`
              : undefined;
          return (
            <section key={group.key} className="mt-4 first:mt-2">
              <button
                type="button"
                aria-expanded={!folded}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-t-lg font-semibold text-text-1 hover:bg-accent"
                onClick={() =>
                  setCollapsed((previous) => {
                    const next = new Set(previous);
                    if (folded) next.delete(group.key);
                    else next.add(group.key);
                    return next;
                  })
                }
              >
                <span className="min-w-0 flex-1 truncate">{group.title}</span>
                <span className="shrink-0 text-t-xs font-medium text-text-4 tabular-nums">
                  {rows.length}
                </span>
                <ChevronDownIcon
                  aria-hidden="true"
                  className={`size-(--icon-md) shrink-0 transition-transform ${
                    folded ? "-rotate-90" : ""
                  }`}
                />
              </button>
              {!folded && (
                <div
                  className="overflow-y-auto rounded-md border border-border"
                  style={{
                    // 装得下就不限高（不显滚动），装不下按弹性份额截断——半行自然裁切。
                    maxHeight,
                  }}
                >
                  {rows.map((item) => (
                    <div
                      key={item.name}
                      className="flex items-start gap-3 border-b border-border px-2 py-2 last:border-0"
                    >
                      <span className="min-w-0 flex-1 break-all text-t-sm text-text-1">
                        {item.name}
                      </span>
                      <span className="shrink-0 text-t-sm text-text-4 tabular-nums">
                        {formatBytes(item.size, "KB", 1)}
                        {item.batch !== null && item.batch !== undefined
                          ? ` · s${item.batch}`
                          : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
    </DialogShell>
  );
}
