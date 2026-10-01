/**
 * 服务域：后端服务的运行状态、日志与停机（后端 routes_service）。
 */

import type { components } from "../api-types.gen";

import { request } from "./client";

export type ServiceStatus = components["schemas"]["ServiceStatus"];
export type ServiceLogs = components["schemas"]["ServiceLogs"];

export const serviceApi = {
  /** 服务运行状态（serve 启动时注入；非 serve 场景后端返回 409）。 */
  getService: () => request<ServiceStatus>("GET", "/api/service"),

  /** 运行日志尾部（最近 lines 行，1–1000；文件未创建时 exists=false）。 */
  getServiceLogs: (lines = 200) =>
    request<ServiceLogs>("GET", `/api/service/logs?lines=${lines}`),

  /** 请求停止服务（服务把手头请求做完再退出；成功即 202）。 */
  shutdownService: () => request<void>("POST", "/api/service/shutdown", {}),
};
