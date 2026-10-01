import type { Dispatch, SetStateAction } from "react";
import { useEffect, useState } from "react";
import { api } from "../../../api";
import type { BatchSelection } from "../batching/BatchSelector";

/** 顶栏状态章：回读磁盘终态＋重读令牌的查询域。 */
export function useBatchRunState(selection: BatchSelection | null): {
  batchRunState: string | null;
  setBatchRunState: Dispatch<SetStateAction<string | null>>;
  setRunStateRevision: Dispatch<SetStateAction<number>>;
} {
  const [batchRunState, setBatchRunState] = useState<string | null>(null);
  // 状态章重读令牌：RunControl 的空闲上报（挂载探测 / 15 秒慢轮）让它递增，
  // 触发下面的 latestRun 重读——「空闲」的正确语义是回读磁盘终态，不是抹空。
  const [runStateRevision, setRunStateRevision] = useState(0);

  // 顶栏状态章的存量事实：进页面 / 换批次时回读磁盘上本批次最近一次运行的终态。
  // 运行中的状态不在这里轮询——由 RunControl 受理即报、SSE 终态也报（见其
  // onRunStatus），避免两处各轮一份。
  // biome-ignore lint/correctness/useExhaustiveDependencies: runStateRevision is a deliberate re-read token bumped by RunControl's idle reports.
  useEffect(() => {
    if (!selection) {
      setBatchRunState(null);
      return;
    }
    let current = true;
    api
      .latestRun(selection.workdirId, selection.batchId)
      .then((history) => {
        if (current) setBatchRunState(history.record?.status ?? null);
      })
      .catch(() => {
        // 摘要读不到（批次刚被删、历史被清）不影响主流程：章留空，主区自己会报错。
      });
    return () => {
      current = false;
    };
  }, [selection, runStateRevision]);

  return { batchRunState, setBatchRunState, setRunStateRevision };
}
