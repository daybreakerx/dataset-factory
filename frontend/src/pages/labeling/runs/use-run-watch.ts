import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, errorMessage } from "../../../api";
import type { components } from "../../../api-types.gen";
import {
  type ItemDelta,
  type ItemUpdate,
  parseItemDelta,
  parseItemUpdate,
} from "./items-state";

export type RunStatus = components["schemas"]["RunStatusView"];

interface Options {
  wid: string;
  batch: string;
  onFinish: () => void | Promise<void>;
  onItemUpdate?: (event: ItemUpdate) => void;
  /** 流式增量转发（A2：跑批逐字呈现）；不转发时增量事件只被忽略。 */
  onItemDelta?: (event: ItemDelta) => void;
  onCurrentItem?: (item: string | null) => void;
  externalRunId?: string;
  /**
   * 报告本批次运行状态的每一次变化（进行中与终态都报），供顶栏状态章显示。
   *
   * 报的是「服务端说的事实」：受理成功报 running、SSE 终态报 run-finished 里的
   * status、轮询到已在进行中的运行也报它自己的 status——父层不必自己猜状态。
   */
  onRunStatus?: (status: string) => void;
}

/**
 * RunControl 的运行观测域收拢：当前运行探测、SSE 订阅、空闲慢轮与重连退避，
 * 含全部迟到护栏（lifecycle 代次、connection 令牌、syncProgress 快照校准）；
 * 发车／停止／发车前名单检查是命令类，留在组件调用点，经这里暴露的状态与
 * 上报口（reportStatus）与观测域协同。
 */
export function useRunWatch({
  wid,
  batch,
  onFinish,
  onItemUpdate,
  onItemDelta,
  onCurrentItem,
  externalRunId,
  onRunStatus,
}: Options) {
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [acceptedRunId, setAcceptedRunId] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [known, setKnown] = useState(false);
  const lifecycle = useRef(0);
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;
  const itemRef = useRef(onItemUpdate);
  itemRef.current = onItemUpdate;
  const itemDeltaRef = useRef(onItemDelta);
  itemDeltaRef.current = onItemDelta;
  const currentItemRef = useRef(onCurrentItem);
  currentItemRef.current = onCurrentItem;
  const runStatusRef = useRef(onRunStatus);
  runStatusRef.current = onRunStatus;
  // 命令侧发车受理成功也要上报状态章（原 start 里的 runStatusRef 消费点）。
  const reportStatus = useCallback((value: string) => {
    runStatusRef.current?.(value);
  }, []);

  useEffect(() => {
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let delay = 1000;
    let observed = acceptedRunId !== null || !!externalRunId;
    let connection = 0;
    const generation = ++lifecycle.current;
    setKnown(false);

    function finish() {
      connection += 1;
      clearTimeout(timer);
      source?.close();
      source = null;
      setStatus(null);
      setCurrent(null);
      currentItemRef.current?.(null);
      setReconnecting(false);
      setKnown(true);
      if (observed) {
        observed = false;
        void Promise.resolve(finishRef.current()).catch((reason: unknown) => {
          if (!disposed) setError(errorMessage(reason));
        });
      }
      // L3（2026-09-21 审计定案）：空闲轮询从 5 秒自续降到 15 秒慢轮——它的存在
      // 理由只剩「发现 CLI 等外部进程启动的运行」（跨进程没有推送通道）；后端已把
      // 「没在跑」改成 200 + null，慢轮不再产生 404 错误噪音。后台标签页暂停。
      timer = setTimeout(() => {
        if (disposed) return;
        if (document.hidden) {
          timer = setTimeout(() => void connect(), 15000);
          return;
        }
        void connect();
      }, 15000);
    }

    function retry() {
      if (disposed) return;
      connection += 1;
      clearTimeout(timer);
      source?.close();
      source = null;
      setReconnecting(true);
      timer = setTimeout(() => void connect(), delay);
      delay = Math.min(delay * 2, 10000);
    }

    async function connect() {
      try {
        const view = await api.currentRun(wid, batch);
        if (disposed) return;
        setKnown(true);
        // 空闲 = 200 + null（L3）：不是错误、也不再轮询；404 只剩 wid / 批次不存在。
        // 空闲必须报给顶栏状态章：运行可能在页面未观察的窗口期结束（如设置抽屉开着
        // 时重打完成），不报会让 batchRunState 卡在 running、把导出入口永久藏住。
        if (view === null) {
          runStatusRef.current?.("idle");
          finish();
          return;
        }
        if (view.status !== "running" && view.status !== "pending") {
          if (view.error) setError(view.error);
          runStatusRef.current?.(view.status);
          finish();
          return;
        }
        observed = true;
        // 闭包里用的收窄副本（TS 不为嵌套函数保留 const 的 null 收窄）。
        const activeRun = view;
        setStatus(view);
        runStatusRef.current?.(view.status);
        setCurrent(view.current_item);
        if (view.current_item) currentItemRef.current?.(view.current_item);
        const token = ++connection;
        const stream = new EventSource(
          `/api/workdirs/${encodeURIComponent(wid)}/batches/${encodeURIComponent(batch)}/runs/stream`,
        );
        source = stream;
        const isCurrent = () => !disposed && token === connection;
        let syncing = false;
        let syncAgain = false;
        let refreshedRunId: string | null = null;
        // 订阅前的事件不会重放；按服务端快照校准，避免客户端增量漏计或重复计数。
        async function syncProgress() {
          syncAgain = true;
          if (syncing) return;
          syncing = true;
          try {
            while (syncAgain && isCurrent()) {
              syncAgain = false;
              const latest = await api.currentRun(wid, batch);
              if (!isCurrent()) return;
              if (latest === null || latest.run_id !== activeRun.run_id) {
                // 空闲 / 换了运行：按收尾处理（B9 连带的 null 语义适配）。
                finish();
                return;
              }
              if (latest.status !== "running" && latest.status !== "pending") {
                if (latest.error) setError(latest.error);
                finish();
                return;
              }
              setStatus(latest);
              if (latest.current_item) currentItemRef.current?.(latest.current_item);
            }
          } catch (reason) {
            if (!isCurrent()) return;
            setError(errorMessage(reason));
            retry();
          } finally {
            syncing = false;
          }
        }
        let ready = false;
        const pending: ItemUpdate[] = [];
        stream.onopen = async () => {
          if (!isCurrent()) return;
          void syncProgress();
          try {
            // B9（2026-09-21 审计定案）：全量条目刷新**每个运行只做一次**——
            // 此前每次 SSE 建连 / 重连都触发一遍 listItems + export/plan。
            // 断线缺口由 syncProgress 的快照校准 + 终态刷新兜底。
            if (refreshedRunId !== activeRun.run_id) {
              refreshedRunId = activeRun.run_id;
              await finishRef.current();
              if (!isCurrent()) return;
            }
            for (const update of pending) itemRef.current?.(update);
            pending.length = 0;
            ready = true;
            delay = 1000;
            setError("");
            setReconnecting(false);
          } catch (reason) {
            if (!isCurrent()) return;
            setError(errorMessage(reason));
            retry();
          }
        };
        stream.addEventListener("run-started", () => {
          if (isCurrent()) void syncProgress();
        });
        stream.addEventListener("item-updated", (event) => {
          if (!isCurrent()) return;
          try {
            const data = parseItemUpdate(
              JSON.parse((event as MessageEvent<string>).data),
            );
            if (data.batch === Number(batch.slice(1))) {
              delay = 1000;
              setCurrent(data.item);
              if (data.status === "started") currentItemRef.current?.(data.item);
              if (ready) itemRef.current?.(data);
              else pending.push(data);
              void syncProgress();
            }
          } catch {
            setError("运行事件格式异常，正在重新同步");
            retry();
          }
        });
        stream.addEventListener("item-delta", (event) => {
          if (!isCurrent()) return;
          try {
            const data = parseItemDelta(
              JSON.parse((event as MessageEvent<string>).data),
            );
            if (data.batch === Number(batch.slice(1))) {
              itemDeltaRef.current?.(data);
            }
          } catch {
            // 增量帧解析失败不打断跑批观察（增量只是呈现层），忽略这一帧。
          }
        });
        stream.addEventListener("run-finished", (event) => {
          if (!isCurrent()) return;
          try {
            const data: unknown = JSON.parse((event as MessageEvent<string>).data);
            if (
              data &&
              typeof data === "object" &&
              "run_id" in data &&
              data.run_id === activeRun.run_id &&
              "batch" in data &&
              data.batch === Number(batch.slice(1)) &&
              "status" in data &&
              ["completed", "interrupted", "failed"].includes(String(data.status))
            ) {
              if (data.status === "failed")
                setError(
                  "error" in data && typeof data.error === "string"
                    ? data.error
                    : "运行失败，请查看运行日志。",
                );
              runStatusRef.current?.(String(data.status));
              finish();
            }
          } catch {
            retry();
          }
        });
        stream.onerror = () => {
          if (isCurrent()) retry();
        };
      } catch (reason) {
        if (disposed) return;
        if (reason instanceof ApiError && reason.status === 404) {
          finish();
        } else {
          setError(errorMessage(reason));
          retry();
        }
      }
    }

    void connect();
    return () => {
      disposed = true;
      if (lifecycle.current === generation) lifecycle.current += 1;
      clearTimeout(timer);
      source?.close();
    };
  }, [wid, batch, acceptedRunId, externalRunId]);

  return {
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
  };
}
