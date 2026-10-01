/**
 * 提示词域：提示词库 CRUD（后端 routes_prompts）。
 */

import type { components } from "../api-types.gen";

import { request } from "./client";

export type PromptInfo = components["schemas"]["PromptInfo"];
export type PromptFull = components["schemas"]["PromptFull"];
export type PromptCreated = components["schemas"]["PromptCreated"];
export type PromptSaveRequest = components["schemas"]["PromptSaveRequest"];
export type PromptRenameRequest = components["schemas"]["PromptRenameRequest"];

export const promptsApi = {
  /** 列出提示词（ID + 显示名 + 描述）。 */
  listPrompts: () => request<PromptInfo[]>("GET", "/api/prompts"),

  /** 新建提示词（服务端分配 ID）。 */
  createPrompt: (payload: PromptSaveRequest) =>
    request<PromptCreated>("POST", "/api/prompts", payload),

  /** 取某个提示词的全文。 */
  getPrompt: (pid: string) =>
    request<PromptFull>("GET", `/api/prompts/${encodeURIComponent(pid)}`),

  /** 覆盖保存提示词全文（按 ID 寻址；旧版进 _history 滚动备份）。 */
  savePrompt: (pid: string, payload: PromptSaveRequest) =>
    request<void>("PUT", `/api/prompts/${encodeURIComponent(pid)}`, payload),

  /** 改显示名（只写 frontmatter 的 name；ID 不变、引用不受影响）。 */
  renamePrompt: (pid: string, payload: PromptRenameRequest) =>
    request<void>("POST", `/api/prompts/${encodeURIComponent(pid)}/rename`, payload),

  /** 删除提示词。 */
  deletePrompt: (pid: string) =>
    request<void>("DELETE", `/api/prompts/${encodeURIComponent(pid)}`),
};
