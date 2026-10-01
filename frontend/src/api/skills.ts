/**
 * Skill 域：技能库 CRUD、导入与包内文件读写（后端 routes_skills）。
 */

import type { components } from "../api-types.gen";

import { request } from "./client";

export type SkillInfo = components["schemas"]["SkillInfo"];
export type SkillImportResponse = components["schemas"]["SkillImportResponse"];
export type SkillRenameRequest = components["schemas"]["SkillRenameRequest"];
export type SkillFilesResponse = components["schemas"]["SkillFilesResponse"];
export type SkillFileInfo = components["schemas"]["SkillFileInfo"];
export type SkillFileContent = components["schemas"]["SkillFileContent"];

export const skillsApi = {
  /** 列出 skill（含启用状态）。 */
  listSkills: () => request<SkillInfo[]>("GET", "/api/skills"),

  /** 从本机路径导入 skill（服务端可访问的路径；目录整包或单个 SKILL.md 文件均可）。 */
  importSkill: (path: string) =>
    request<SkillImportResponse>("POST", "/api/skills/import", { path }),

  /** 上传导入 skill 包（文件夹选择器 / 拖拽选中的文件集；传内容不传路径）。 */
  importSkillFiles: (files: File[]) => {
    const form = new FormData();
    for (const file of files) {
      const relative = file.webkitRelativePath || file.name;
      form.append("files", file, relative);
    }
    return request<SkillImportResponse>("POST", "/api/skills/import-upload", form);
  },

  /** 上传导入单个 SKILL.md 文件（无文件夹结构的单文件 skill；统一按 SKILL.md 交付）。 */
  importSkillFile: (file: File) => {
    const form = new FormData();
    form.append("files", file, "SKILL.md");
    return request<SkillImportResponse>("POST", "/api/skills/import-upload", form);
  },

  /** 改 skill 显示名（只写 SKILL.md frontmatter 的 name；ID 不变、引用不受影响）。 */
  renameSkill: (sid: string, payload: SkillRenameRequest) =>
    request<void>("POST", `/api/skills/${encodeURIComponent(sid)}/rename`, payload),

  /** 启用 / 停用 skill（停用不删除）。 */
  setSkillEnabled: (sid: string, enabled: boolean) =>
    request<void>(
      "POST",
      `/api/skills/${encodeURIComponent(sid)}/${enabled ? "enable" : "disable"}`,
    ),

  /** 从库中移除 skill（整目录）。 */
  deleteSkill: (sid: string) =>
    request<void>("DELETE", `/api/skills/${encodeURIComponent(sid)}`),

  /** 列出技能包内文件（角色标注：SKILL.md / references 可预览，assets / scripts 不可）。 */
  listSkillFiles: (sid: string) =>
    request<SkillFilesResponse>("GET", `/api/skills/${encodeURIComponent(sid)}/files`),

  /** 读技能包内一个可预览文件的文本内容（UTF-8）。 */
  readSkillFile: (sid: string, path: string) =>
    request<SkillFileContent>(
      "GET",
      `/api/skills/${encodeURIComponent(sid)}/files/${path
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`,
    ),

  /** 保存技能文本，原始内容用于检测并发修改。 */
  saveSkillFile: (
    sid: string,
    path: string,
    payload: components["schemas"]["SkillFileSaveRequest"],
  ) =>
    request<SkillFileContent>(
      "PUT",
      `/api/skills/${encodeURIComponent(sid)}/files/${path.split("/").map(encodeURIComponent).join("/")}`,
      payload,
    ),
};
