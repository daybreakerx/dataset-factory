/**
 * 策略域：策略库 CRUD、复制与重绑定（后端 routes_strategies 的 library 路由）。
 */

import type { components } from "../api-types.gen";

import { request } from "./client";

export const strategiesApi = {
  listStrategies: () =>
    request<components["schemas"]["StrategyView"][]>("GET", "/api/strategies"),

  getStrategy: (id: string) =>
    request<components["schemas"]["StrategyView"]>(
      "GET",
      `/api/strategies/${encodeURIComponent(id)}`,
    ),

  createStrategy: (body: components["schemas"]["StrategySaveRequest"]) =>
    request<components["schemas"]["StrategyView"]>("POST", "/api/strategies", body),

  updateStrategy: (id: string, body: components["schemas"]["StrategySaveRequest"]) =>
    request<components["schemas"]["StrategyView"]>(
      "PUT",
      `/api/strategies/${encodeURIComponent(id)}`,
      body,
    ),

  copyStrategy: (id: string) =>
    request<components["schemas"]["StrategyView"]>(
      "POST",
      `/api/strategies/${encodeURIComponent(id)}/copy`,
    ),

  rebindStrategy: (id: string, body: components["schemas"]["StrategyRebindRequest"]) =>
    request<components["schemas"]["StrategyView"]>(
      "POST",
      `/api/strategies/${encodeURIComponent(id)}/rebind`,
      body,
    ),

  deleteStrategy: (id: string) =>
    request<void>("DELETE", `/api/strategies/${encodeURIComponent(id)}`),
};
