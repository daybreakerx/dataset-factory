/**
 * 跑批域：运行控制与状态、运行产物读取、重试清单（后端 routes_runs）。
 */

import type { components } from "../api-types.gen";

import { request } from "./client";

export const runsApi = {
  latestRun: (wid: string, batch: string) =>
    request<components["schemas"]["RunHistoryView"]>(
      "GET",
      `/api/workdirs/${encodeURIComponent(wid)}/batches/${encodeURIComponent(batch)}/runs/latest`,
    ),

  readRunText: (
    wid: string,
    batch: string,
    runId: string,
    file: "run.log" | "items.jsonl",
  ) =>
    request<components["schemas"]["RunTextView"]>(
      "GET",
      `/api/workdirs/${encodeURIComponent(wid)}/batches/${encodeURIComponent(batch)}/runs/${encodeURIComponent(runId)}/text?file=${encodeURIComponent(file)}`,
    ),

  addRetryItems: (wid: string, batch: string, items: string[]) =>
    request<components["schemas"]["RetryListView"]>(
      "POST",
      `/api/workdirs/${encodeURIComponent(wid)}/batches/${encodeURIComponent(batch)}/retry-list`,
      { items },
    ),

  removeRetryItem: (wid: string, batch: string, item: string) =>
    request<components["schemas"]["RetryListView"]>(
      "DELETE",
      `/api/workdirs/${encodeURIComponent(wid)}/batches/${encodeURIComponent(batch)}/retry-list/${encodeURIComponent(item)}`,
    ),

  clearRetryItems: (wid: string, batch: string) =>
    request<components["schemas"]["RetryListView"]>(
      "DELETE",
      `/api/workdirs/${encodeURIComponent(wid)}/batches/${encodeURIComponent(batch)}/retry-list`,
    ),

  startRun: (wid: string, batch: string, mode: "full" | "retry", items?: string[]) =>
    request<components["schemas"]["RunAccepted"]>(
      "POST",
      `/api/workdirs/${encodeURIComponent(wid)}/batches/${encodeURIComponent(batch)}/runs`,
      { mode, ...(items ? { items } : {}) },
    ),

  currentRun: (wid: string, batch: string) =>
    request<components["schemas"]["RunStatusView"] | null>(
      "GET",
      `/api/workdirs/${encodeURIComponent(wid)}/batches/${encodeURIComponent(batch)}/runs/current`,
    ),

  /** 停两档（2026-10-06 用户裁）：graceful＝等当前条目打到安全点；immediate＝掐断在途生成。 */
  stopRun: (wid: string, batch: string, mode: "graceful" | "immediate" = "graceful") =>
    request<void>(
      "POST",
      `/api/workdirs/${encodeURIComponent(wid)}/batches/${encodeURIComponent(batch)}/runs/stop`,
      { mode },
    ),
};
