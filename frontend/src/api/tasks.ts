/**
 * 异步任务域：后台任务的查询与取消（后端 routes_tasks）。
 */

import { request } from "./client";

export interface TaskView {
  id: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  progress: number;
  result: unknown;
  error: string | null;
}

function parseTask(value: unknown): TaskView {
  if (
    !value ||
    typeof value !== "object" ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    !("status" in value) ||
    (value.status !== "running" &&
      value.status !== "succeeded" &&
      value.status !== "failed" &&
      value.status !== "cancelled") ||
    !("progress" in value) ||
    typeof value.progress !== "number" ||
    !Number.isFinite(value.progress) ||
    !("result" in value) ||
    !("error" in value) ||
    (value.error !== null && typeof value.error !== "string")
  ) {
    throw new Error("任务响应格式异常，请刷新后重试");
  }
  return {
    id: value.id,
    status: value.status,
    progress: value.progress,
    result: value.result,
    error: value.error,
  };
}

export const tasksApi = {
  getTask: async (id: string) =>
    parseTask(await request<unknown>("GET", `/api/tasks/${encodeURIComponent(id)}`)),

  cancelTask: async (id: string) =>
    parseTask(
      await request<unknown>("POST", `/api/tasks/${encodeURIComponent(id)}/cancel`),
    ),
};
