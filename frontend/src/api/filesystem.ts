/**
 * 文件系统域：服务器目录浏览 / 改名 / 新建 / 能力探测 / 打开（后端 routes_filesystem）。
 */

import type { components } from "../api-types.gen";

import { request } from "./client";

export const filesystemApi = {
  listDirectory: (
    path: string,
    showFiles = false,
    showHidden = false,
    suffixes: string[] = [],
  ) => {
    const query = new URLSearchParams({
      show_files: String(showFiles),
      show_hidden: String(showHidden),
    });
    if (path) query.set("path", path);
    for (const suffix of suffixes) query.append("suffixes", suffix);
    return request<components["schemas"]["DirectoryListing"]>(
      "GET",
      `/api/filesystem?${query}`,
    );
  },

  renameDirectory: (path: string, newName: string) =>
    request<components["schemas"]["WorkdirRelocateAccepted"]>(
      "POST",
      "/api/filesystem/rename",
      { path, new_name: newName },
    ),

  createDirectory: (parent: string, name: string) =>
    request<components["schemas"]["DirectoryPath"]>(
      "POST",
      "/api/filesystem/directories",
      { parent, name },
    ),

  filesystemCapabilities: () =>
    request<components["schemas"]["FilesystemCapabilities"]>(
      "GET",
      "/api/filesystem/capabilities",
    ),

  openDirectory: (path: string) =>
    request<void>("POST", "/api/filesystem/open", { path }),
};
