import { useEffect, useState } from "react";
import { ApiError, api, errorMessage } from "../../../api";
import type { components } from "../../../api-types.gen";

export type Batch = components["schemas"]["BatchView"];
export type Directory = components["schemas"]["WorkdirInfo"];

type CleanupSummary = {
  products: components["schemas"]["CleanupPreview"];
  runs: components["schemas"]["RunCleanupEntry"][];
};

/** WorkdirSettings 的查询域收拢：目录元数据与策略列表、运行状态轮询、清理摘要、统计与搬迁记录；mutation 后经 refresh 统一失效重取。 */
export function useWorkdirData(wid: string, onChanged: () => void) {
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [cleanupSummary, setCleanupSummary] = useState<CleanupSummary | null>(null);
  const [summaryError, setSummaryError] = useState("");
  const [stats, setStats] = useState<components["schemas"]["WorkdirStatsView"] | null>(
    null,
  );
  const [statsError, setStatsError] = useState("");
  const [runStates, setRunStates] = useState<Record<string, boolean>>({});
  const [runError, setRunError] = useState("");
  const [relocations, setRelocations] = useState<
    components["schemas"]["WorkdirRelocationStatus"][]
  >([]);
  const [maintenanceError, setMaintenanceError] = useState("");

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setRunStates({});
    setRunError("");
    async function poll() {
      const next: Record<string, boolean> = {};
      let failure = "";
      let anyRunning = false;
      await Promise.all(
        batches.map(async (batch) => {
          try {
            const state = await api.currentRun(wid, batch.id);
            // 空闲 = 200 + null（L3 后端语义）：不是错误，照常记 false。
            next[batch.id] =
              state !== null &&
              (state.status === "pending" || state.status === "running");
            if (next[batch.id]) anyRunning = true;
          } catch (reason) {
            if (reason instanceof ApiError && reason.status === 404)
              next[batch.id] = false;
            else failure = errorMessage(reason);
          }
        }),
      );
      if (disposed) return;
      setRunStates(next);
      setRunError(failure);
      // L4/B9（2026-09-21 审计）：有运行才 3 秒紧轮询；全部空闲时降到 15 秒——
      // 空闲页面的高频全批次轮询是无谓请求，还把真错误淹在日志里。
      timer = setTimeout(() => void poll(), anyRunning ? 3000 : 15000);
    }
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [wid, batches]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision invalidates the maintenance summaries after mutations.
  useEffect(() => {
    let current = true;
    setCleanupSummary(null);
    setSummaryError("");
    void Promise.all([api.previewProductCleanup(wid), api.previewRunCleanup(wid)]).then(
      ([products, runs]) => {
        if (current) setCleanupSummary({ products, runs });
      },
      (reason: unknown) => {
        if (current) setSummaryError(errorMessage(reason));
      },
    );
    return () => {
      current = false;
    };
  }, [wid, revision]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision refreshes physical material statistics after mutations.
  useEffect(() => {
    let current = true;
    setStats(null);
    setStatsError("");
    void api.getWorkdirStats(wid).then(
      (value) => {
        if (current) setStats(value);
      },
      (reason: unknown) => {
        if (current) setStatsError(errorMessage(reason));
      },
    );
    return () => {
      current = false;
    };
  }, [wid, revision]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision refreshes persistent relocation records after maintenance.
  useEffect(() => {
    let current = true;
    setMaintenanceError("");
    void api.relocationStatus(wid).then(
      (value) => {
        if (current) setRelocations(value);
      },
      (reason: unknown) => {
        if (current) setMaintenanceError(errorMessage(reason));
      },
    );
    return () => {
      current = false;
    };
  }, [wid, revision]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision refreshes directory metadata after mutations.
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    void Promise.all([api.getWorkdir(wid), api.listBatches(wid)])
      .then(
        ([entry, list]) => {
          if (current) {
            setDirectory(entry);
            setBatches(list);
          }
        },
        (reason: unknown) => {
          if (current) setError(errorMessage(reason));
        },
      )
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [wid, revision]);

  function refresh() {
    setRevision((value) => value + 1);
    onChanged();
  }

  return {
    directory,
    batches,
    error,
    loading,
    runStates,
    runError,
    cleanupSummary,
    summaryError,
    stats,
    statsError,
    relocations,
    maintenanceError,
    setMaintenanceError,
    refresh,
  };
}
