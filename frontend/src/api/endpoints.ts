/**
 * 端点配置域：多套端点配置的 CRUD 与连通性测试（后端 routes_endpoints）。
 * 全局激活机制已退役（ADR 2026-09-30）：请求显式携带端点，没有「当前使用」指针。
 */

import type { components } from "../api-types.gen";

import { PROBE_TIMEOUT_MS, request } from "./client";

export type EndpointConfigSummary = components["schemas"]["EndpointConfigSummary"];
export type EndpointRequestParams = components["schemas"]["EndpointRequestParams"];
export type EndpointCreateRequest = components["schemas"]["EndpointCreateRequest"];
export type EndpointUpdateRequest = components["schemas"]["EndpointUpdateRequest"];
export type EndpointTestRequest = components["schemas"]["EndpointTestRequest"];
export type EndpointTestResult = components["schemas"]["EndpointTestResult"];

export const endpointsApi = {
  /** 列出端点多配置概要（密钥只报有无）。 */
  listEndpoints: () => request<EndpointConfigSummary[]>("GET", "/api/endpoints"),

  /** 新增一套端点配置。 */
  createEndpoint: (payload: EndpointCreateRequest) =>
    request<EndpointConfigSummary>("POST", "/api/endpoints", payload),

  /** 更新一套端点配置（按 ID 寻址；api_key 缺省沿用已存密钥；new_name 改显示名）。 */
  updateEndpoint: (cid: string, payload: EndpointUpdateRequest) =>
    request<EndpointConfigSummary>(
      "PUT",
      `/api/endpoints/${encodeURIComponent(cid)}`,
      payload,
    ),

  /** 删除一套端点配置（无前置拦截，任何配置可删）。 */
  deleteEndpoint: (cid: string) =>
    request<void>("DELETE", `/api/endpoints/${encodeURIComponent(cid)}`),

  /** 测试端点连通性（用表单当前值发极小真实请求；密钥缺省回落该配置已存密钥）。 */
  testEndpoint: (payload: EndpointTestRequest) =>
    request<EndpointTestResult>(
      "POST",
      "/api/endpoints/test",
      payload,
      PROBE_TIMEOUT_MS,
    ),
};
