/**
 * 会话域：会话快照的读取与归属改挂、附件字节地址（后端 routes_labeling 的会话半边）。
 */

import type { components } from "../api-types.gen";

import { request } from "./client";

export type SessionSnapshotResponse = components["schemas"]["SessionSnapshotResponse"];
export type HistoryMessageView = components["schemas"]["HistoryMessageView"];

export const sessionsApi = {
  /**
   * 取最新会话快照（重启后恢复界面的入口）。
   * 带 strategyId 时按归属桶取最新（会话归属 v3：每策略各自的最近会话）；
   * 不带为全局最新（存量认领垫层）。
   */
  latestSession: (strategyId?: string) =>
    request<SessionSnapshotResponse>(
      "GET",
      `/api/sessions/latest${strategyId === undefined ? "" : `?strategy_id=${encodeURIComponent(strategyId)}`}`,
    ),

  /** 改挂会话归属（保存新策略时把草稿会话从 __new__ 挂到新策略 id）。 */
  assignSessionStrategy: (sessionId: string, strategyId: string) =>
    request<SessionSnapshotResponse>(
      "POST",
      `/api/sessions/${encodeURIComponent(sessionId)}/strategy`,
      { strategy_id: strategyId },
    ),

  /**
   * 会话附件的字节地址（B5）：历史缩略图直接指向它，刷新 / 重开页面仍能显示。
   * 图片走 <img src>，不需要请求封装；名字与 id 都经 URL 编码防注入。
   */
  sessionAttachmentUrl: (sessionId: string, name: string) =>
    `/api/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(name)}`,
};
