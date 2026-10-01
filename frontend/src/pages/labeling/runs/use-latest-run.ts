import { useEffect, useState } from "react";
import { ApiError, api, errorMessage } from "../../../api";
import type { components } from "../../../api-types.gen";

export type RunHistory = components["schemas"]["RunHistoryView"];

/**
 * RunOverview 的查询域收拢：本批次最近一次运行摘要——运行中每 2 秒轮询，
 * 409／网络／超时按退避重试；条目刷新（refreshKey）与手动重查（revision）
 * 触发重读。换批次时清空摘要并经 onIdentityChange 联动组件侧的随行清理
 * （日志弹窗选中态），次序与拆分前一致：先清后轮询。
 */
export function useLatestRun(
  wid: string,
  batch: string,
  refreshKey: unknown,
  onIdentityChange: () => void,
) {
  const [history, setHistory] = useState<RunHistory | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: changing batch identity clears the previous summary and selected log.
  useEffect(() => {
    setHistory(null);
    onIdentityChange();
  }, [wid, batch, onIdentityChange]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: item refresh and manual revision refresh the disk summary.
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = 500;
    async function load() {
      try {
        const value = await api.latestRun(wid, batch);
        if (!current) return;
        setHistory(value);
        setError("");
        retryDelay = 500;
        if (value.record?.status === "running")
          timer = setTimeout(() => void load(), 2000);
      } catch (reason) {
        if (!current) return;
        setError(errorMessage(reason));
        if (
          reason instanceof ApiError &&
          (reason.status === 409 ||
            reason.kind === "network" ||
            reason.kind === "timeout")
        ) {
          timer = setTimeout(() => void load(), retryDelay);
          retryDelay = Math.min(retryDelay * 2, 5000);
        }
      }
    }
    void load();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [wid, batch, refreshKey, revision]);

  return { history, error, setRevision };
}
