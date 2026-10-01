/**
 * 批次域：批次（策略实例）CRUD、快照、排除项与条目内容（后端批次路由＋routes_items）。
 */

import type { components } from "../api-types.gen";

import { DEFAULT_TIMEOUT_MS, request } from "./client";

export const batchesApi = {
  setExclusions: (wid: string, batch: string, items: string[], excluded: boolean) =>
    request<components["schemas"]["ExclusionsView"]>(
      excluded ? "POST" : "DELETE",
      `/api/workdirs/${encodeURIComponent(wid)}/batches/${encodeURIComponent(batch)}/exclusions`,
      { items },
    ),

  createBatch: (wid: string, body: components["schemas"]["BatchCreateRequest"]) =>
    request<components["schemas"]["BatchView"]>(
      "POST",
      `/api/workdirs/${encodeURIComponent(wid)}/batches`,
      body,
    ),

  readCaption: (wid: string, batch: string, item: string) =>
    request<string>(
      "GET",
      `/api/workdirs/${encodeURIComponent(wid)}/batches/${encodeURIComponent(batch)}/items/${encodeURIComponent(item)}/txt`,
      undefined,
      DEFAULT_TIMEOUT_MS,
      "text",
    ),

  updateBatch: (
    wid: string,
    batch: string,
    body: components["schemas"]["BatchUpdateRequest"],
  ) =>
    request<components["schemas"]["BatchView"]>(
      "PATCH",
      `/api/workdirs/${encodeURIComponent(wid)}/batches/${encodeURIComponent(batch)}`,
      body,
    ),

  setBatchActive: (wid: string, batch: string, active: boolean) =>
    request<components["schemas"]["BatchView"]>(
      "POST",
      `/api/workdirs/${encodeURIComponent(wid)}/batches/${encodeURIComponent(batch)}/${active ? "unhide" : "hide"}`,
      {},
    ),

  deleteBatch: (wid: string, batch: string) =>
    request<void>(
      "DELETE",
      `/api/workdirs/${encodeURIComponent(wid)}/batches/${encodeURIComponent(batch)}`,
    ),

  listBatches: (wid: string) =>
    request<components["schemas"]["BatchView"][]>(
      "GET",
      `/api/workdirs/${encodeURIComponent(wid)}/batches`,
    ),

  getBatchSnapshot: (wid: string, batch: string) =>
    request<components["schemas"]["BatchSnapshotView"]>(
      "GET",
      `/api/workdirs/${encodeURIComponent(wid)}/batches/${encodeURIComponent(batch)}/snapshot`,
    ),

  listItems: (wid: string, batch: string) =>
    request<components["schemas"]["ItemListView"]>(
      "GET",
      `/api/workdirs/${encodeURIComponent(wid)}/batches/${encodeURIComponent(batch)}/items`,
    ),
};
