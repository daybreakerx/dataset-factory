import { render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../../../api";
import { getToastSnapshot, removeToast } from "../../../lib/toast";
import { useWorkdirBatches } from "./use-workdir-batches";

// 部分 mock：只换 api 方法、保留真 ApiError／errorMessage——reportError 的
// instanceof 分档（连接类 → Toast）依赖真实类，整模块假类会把分档打穿
// （见 memory「整体 mock 掉 api 模块的测试文件拿不到真 ApiError」）。
vi.mock("../../../api", async (original) => ({
  ...(await original<typeof import("../../../api")>()),
  api: {
    listWorkdirs: vi.fn(),
    listBatches: vi.fn(),
  },
}));

/**
 * 挂账第 1 条裁决 B（2026-10-06）的语义钉子：workdir 取数失败走单一通路，
 * 不再馈页面横幅（横幅通路由签名结构性撤除——本 hook 不再收 setError）。
 * 本文件钉运行时半边：连接类 → Toast、业务类 → 弹层失败行、各不越界。
 */
function Probe(): ReactElement {
  const { loadError, flight } = useWorkdirBatches({ setLoading: () => {} });
  return (
    <p data-testid="state">{`flight=${flight} loadError=${loadError ?? "null"}`}</p>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

afterEach(() => {
  // toast 是模块级单例：清场防同文件用例间串状态（文件间由 vitest 模块隔离兜底）。
  for (const item of getToastSnapshot()) removeToast(item.id);
});

describe("useWorkdirBatches 取数失败的单一通路（挂账第 1 条裁决 B）", () => {
  it("连接类失败：转 Toast 浮层，弹层不占失败行（保留旧数据）", async () => {
    vi.mocked(api.listWorkdirs).mockRejectedValue(
      new ApiError(
        "network",
        "无法连接后端服务——请确认 dsf serve 已启动、端口没有填错",
        null,
        null,
      ),
    );
    render(<Probe />);
    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent(
        "flight=false loadError=null",
      ),
    );
    expect(getToastSnapshot().map((item) => item.text)).toEqual([
      "无法连接后端服务——请确认 dsf serve 已启动、端口没有填错",
    ]);
  });

  it("业务类失败：进弹层失败行，不出 Toast", async () => {
    vi.mocked(api.listWorkdirs).mockRejectedValue(
      new ApiError("http", "工作目录不在注册表中", 404, "req-1"),
    );
    render(<Probe />);
    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent(
        "flight=false loadError=工作目录读取失败",
      ),
    );
    expect(getToastSnapshot()).toEqual([]);
  });
});
