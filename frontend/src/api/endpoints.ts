/**
 * 端点配置域：多套端点配置的 CRUD / 激活 / 连通性测试，以及旧版全局配置的读写
 * （后端 routes_endpoints ＋ routes_config——同属端点配置这一族）。
 */

import type { components } from "../api-types.gen";

import { PROBE_TIMEOUT_MS, request } from "./client";

export type ConfigResponse = components["schemas"]["ConfigResponse"];
export type ConfigUpdateRequest = components["schemas"]["ConfigUpdateRequest"];
export type EndpointConfigSummary = components["schemas"]["EndpointConfigSummary"];
export type EndpointRequestParams = components["schemas"]["EndpointRequestParams"];
export type EndpointCreateRequest = components["schemas"]["EndpointCreateRequest"];
export type EndpointUpdateRequest = components["schemas"]["EndpointUpdateRequest"];
export type EndpointTestRequest = components["schemas"]["EndpointTestRequest"];
export type EndpointTestResult = components["schemas"]["EndpointTestResult"];

export const endpointsApi = {
  /** 读当前端点配置（密钥只报来源、绝不回内容）。 */
  getConfig: () => request<ConfigResponse>("GET", "/api/config"),

  /** 写端点配置（api_key 缺省表示沿用已存密钥）。 */
  updateConfig: (payload: ConfigUpdateRequest) =>
    request<void>("PUT", "/api/config", payload),

  /** 列出端点多配置概要（密钥只报有无）。 */
  listEndpoints: () => request<EndpointConfigSummary[]>("GET", "/api/endpoints"),

  /** 新增一套端点配置；当前没有生效配置时后端自动设为当前使用。 */
  createEndpoint: (payload: EndpointCreateRequest) =>
    request<EndpointConfigSummary>("POST", "/api/endpoints", payload),

  /** 更新一套端点配置（按 ID 寻址；api_key 缺省沿用已存密钥；new_name 改显示名）。 */
  updateEndpoint: (cid: string, payload: EndpointUpdateRequest) =>
    request<EndpointConfigSummary>(
      "PUT",
      `/api/endpoints/${encodeURIComponent(cid)}`,
      payload,
    ),

  /** 删除一套端点配置（当前使用中的会被后端拒绝）。 */
  deleteEndpoint: (cid: string) =>
    request<void>("DELETE", `/api/endpoints/${encodeURIComponent(cid)}`),

  /** 把一套配置设为当前使用；对新请求立即生效。 */
  activateEndpoint: (cid: string) =>
    request<void>("POST", `/api/endpoints/${encodeURIComponent(cid)}/activate`),

  /** 测试端点连通性（用表单当前值发极小真实请求；密钥缺省回落该配置已存密钥）。 */
  testEndpoint: (payload: EndpointTestRequest) =>
    request<EndpointTestResult>(
      "POST",
      "/api/endpoints/test",
      payload,
      PROBE_TIMEOUT_MS,
    ),
};
