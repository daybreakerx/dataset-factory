/**
 * 工作目录域：目录 CRUD、统计、导入、完整性、清理与迁移（后端 routes_workdir）。
 */

import type { components } from "../api-types.gen";

import { request } from "./client";

export const workdirApi = {
  rebuildImportRecords: (wid: string) =>
    request<components["schemas"]["ImportAccepted"]>(
      "POST",
      `/api/workdirs/${encodeURIComponent(wid)}/imports/rebuild`,
    ),

  scanIntegrity: (wid: string, batch: string) =>
    request<components["schemas"]["IntegrityReport"]>(
      "POST",
      `/api/workdirs/${encodeURIComponent(wid)}/integrity/scan?batch=${encodeURIComponent(batch)}`,
    ),

  createWorkdir: (body: components["schemas"]["WorkdirCreateRequest"]) =>
    request<components["schemas"]["WorkdirCreateAccepted"]>(
      "POST",
      "/api/workdirs",
      body,
    ),

  importMaterials: (wid: string, body: components["schemas"]["WorkdirImportRequest"]) =>
    request<components["schemas"]["ImportAccepted"]>(
      "POST",
      `/api/workdirs/${encodeURIComponent(wid)}/imports`,
      body,
    ),

  reimportMaterials: (wid: string, names: string[], forceNames?: string[]) =>
    request<components["schemas"]["ImportAccepted"]>(
      "POST",
      `/api/workdirs/${encodeURIComponent(wid)}/imports/reimport`,
      { names, ...(forceNames ? { force_names: forceNames } : {}) },
    ),

  removeUnimported: (wid: string, names: string[]) =>
    request<components["schemas"]["CleanupResult"]>(
      "POST",
      `/api/workdirs/${encodeURIComponent(wid)}/unimported/remove`,
      { names },
    ),

  /** 发车前扫描摘要（V16）：这一跑吃多少、收哪些、不收哪些、为什么。 */
  scanPreview: (wid: string) =>
    request<components["schemas"]["ScanPreviewView"]>(
      "GET",
      `/api/workdirs/${encodeURIComponent(wid)}/scan-preview`,
    ),

  listWorkdirs: () =>
    request<components["schemas"]["WorkdirInfo"][]>("GET", "/api/workdirs"),

  getWorkdir: (wid: string) =>
    request<components["schemas"]["WorkdirInfo"]>(
      "GET",
      `/api/workdirs/${encodeURIComponent(wid)}`,
    ),

  getWorkdirStats: (wid: string) =>
    request<components["schemas"]["WorkdirStatsView"]>(
      "GET",
      `/api/workdirs/${encodeURIComponent(wid)}/stats`,
    ),

  previewProductCleanup: (wid: string) =>
    request<components["schemas"]["CleanupPreview"]>(
      "GET",
      `/api/workdirs/${encodeURIComponent(wid)}/cleanup-preview`,
    ),

  previewWorkdirDeletion: (wid: string) =>
    request<components["schemas"]["DeletionPreview"]>(
      "GET",
      `/api/workdirs/${encodeURIComponent(wid)}/delete-preview`,
    ),

  relocateWorkdir: (wid: string, path: string) =>
    request<components["schemas"]["WorkdirRelocateAccepted"]>(
      "POST",
      `/api/workdirs/${encodeURIComponent(wid)}/relocate`,
      { path },
    ),

  relocationStatus: (wid: string) =>
    request<components["schemas"]["WorkdirRelocationStatus"][]>(
      "GET",
      `/api/workdirs/${encodeURIComponent(wid)}/relocate/status`,
    ),

  retryRelocationCleanup: (wid: string, oldPath: string) =>
    request<components["schemas"]["WorkdirCleanupRetryResult"]>(
      "POST",
      `/api/workdirs/${encodeURIComponent(wid)}/relocate/cleanup`,
      { old_path: oldPath },
    ),

  deleteWorkdir: (wid: string, confirmedPath: string) =>
    request<components["schemas"]["DeletionResult"]>(
      "DELETE",
      `/api/workdirs/${encodeURIComponent(wid)}`,
      { confirmed_path: confirmedPath },
    ),

  previewRunCleanup: (wid: string) =>
    request<components["schemas"]["RunCleanupEntry"][]>(
      "GET",
      `/api/workdirs/${encodeURIComponent(wid)}/cleanup-runs-preview`,
    ),

  cleanupWorkdir: (wid: string, kind: "products" | "runs", names: string[]) =>
    request<components["schemas"]["CleanupResult"]>(
      "POST",
      `/api/workdirs/${encodeURIComponent(wid)}/${kind === "runs" ? "cleanup-runs" : "cleanup"}`,
      { names },
    ),
};
