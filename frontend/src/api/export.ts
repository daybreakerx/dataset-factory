/**
 * 导出域：导出计划与发起导出（后端 routes_export）。
 */

import type { components } from "../api-types.gen";

import { request } from "./client";

export const exportApi = {
  exportPlan: (wid: string, batch: string, sequential: boolean) =>
    request<components["schemas"]["ExportPlanView"]>(
      "GET",
      `/api/workdirs/${encodeURIComponent(wid)}/export/plan?batch=${encodeURIComponent(batch)}&sequential=${sequential}`,
    ),

  startExport: (wid: string, batch: string, sequential: boolean) =>
    request<components["schemas"]["ExportAccepted"]>(
      "POST",
      `/api/workdirs/${encodeURIComponent(wid)}/export`,
      { batch, mode: "current", sequential },
    ),
};
