/**
 * 服务域：后端服务的运行状态、日志与停机（后端 routes_service）。
 */

import type { components } from "../api-types.gen";

import { request } from "./client";

export type ServiceStatus = components["schemas"]["ServiceStatus"];
export type ServiceLogs = components["schemas"]["ServiceLogs"];
export type ServiceBusy = components["schemas"]["ServiceBusy"];

export const serviceApi = {
  /** 服务运行状态（serve 启动时注入；非 serve 场景后端返回 409）。 */
  getService: () => request<ServiceStatus>("GET", "/api/service"),

  /** 运行日志尾部（最近 lines 行，1–1000；默认吃满契约上限——200 系 F6 初始设计值，
   *  无性能约束，2026-10-05 用户裁 200→1000；文件未创建时 exists=false）。 */
  getServiceLogs: (lines = 1000) =>
    request<ServiceLogs>("GET", `/api/service/logs?lines=${lines}`),

  /** 有几件事正在跑（关机确认弹窗据此决定要不要出警告行）。 */
  getServiceBusy: () => request<ServiceBusy>("GET", "/api/service/busy"),

  /** 请求停止服务（服务把手头请求做完再退出；成功即 202）。 */
  shutdownService: () => request<void>("POST", "/api/service/shutdown", {}),
};
