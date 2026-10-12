import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, type TaskView } from "../../../api";
import { ToastViewport } from "../../../components/ui/toast";
import { getToastSnapshot, removeToast } from "../../../lib/toast";
import { RebuildImportsDialog } from "./RebuildImportsDialog";

vi.mock("../../../api", async (original) => ({
  ...(await original<typeof import("../../../api")>()),
  api: { rebuildImportRecords: vi.fn(), getTask: vi.fn() },
}));

const succeeded: TaskView = {
  id: "rebuild-1",
  status: "succeeded",
  progress: 1,
  result: { file_count: 3, source: "" },
  error: null,
};

/** 页脚钮（壳的关闭叉与页脚「取消」同名，取页脚那枚免撞严格模式）。 */
function footerButton(name: string): HTMLElement {
  const footer = document.querySelector<HTMLElement>('[data-slot="dialog-footer"]');
  if (!footer) throw new Error("弹窗页脚未渲染");
  return within(footer).getByRole("button", { name });
}

function renderDialog() {
  const onClose = vi.fn();
  const onRebuilt = vi.fn();
  const onBackground = vi.fn();
  const helpers = render(
    <>
      <RebuildImportsDialog
        wid="work"
        workdirPath={"D:\\df-work\\人物校服"}
        onClose={onClose}
        onRebuilt={onRebuilt}
        onBackground={onBackground}
      />
      <ToastViewport />
    </>,
  );
  return { onClose, onRebuilt, onBackground, unmount: helpers.unmount };
}

beforeEach(() => {
  vi.resetAllMocks();
  // 浮层是模块级存储、驻留 5s，不清会跨用例串台。
  for (const item of getToastSnapshot()) removeToast(item.id);
  vi.mocked(api.rebuildImportRecords).mockResolvedValue({ task_id: "rebuild-1" });
  vi.mocked(api.getTask).mockResolvedValue(succeeded);
});

describe("重建导入记录", () => {
  it("打开即说明一句、无死文案副题，头右给工作目录真值", () => {
    renderDialog();

    expect(
      screen.getByText("将以原地导入形式为当前工作目录重建导入记录"),
    ).toBeInTheDocument();
    expect(screen.queryByText("当前工作目录")).not.toBeInTheDocument();
    expect(screen.getByText("D:\\df-work\\人物校服")).toBeInTheDocument();
    expect(api.rebuildImportRecords).not.toHaveBeenCalled();
  });

  it("成功后自动关窗并浮层汇报，宿主仍收到重扫通知", async () => {
    const user = userEvent.setup();
    const { onClose, onRebuilt } = renderDialog();

    await user.click(footerButton("重建导入记录"));

    expect(api.rebuildImportRecords).toHaveBeenCalledExactlyOnceWith("work");
    expect(await screen.findByText("重建完成 · 登记素材 3 条")).toBeInTheDocument();
    expect(onClose).toHaveBeenCalledOnce();
    expect(onRebuilt).toHaveBeenCalledOnce();
  });

  it("飞行期页脚左状态槽＋取消与主钮都禁用，Esc 关窗把句柄交宿主", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getTask).mockImplementation(() => new Promise(() => {}));
    const { onClose, onRebuilt, onBackground } = renderDialog();
    await user.click(footerButton("重建导入记录"));
    await screen.findByText("正在重建");

    expect(footerButton("取消")).toBeDisabled();
    expect(footerButton("重建导入记录")).toBeDisabled();
    expect(screen.queryByText("重新查询")).not.toBeInTheDocument();
    await user.keyboard("{Escape}");

    expect(onBackground).toHaveBeenCalledExactlyOnceWith("rebuild-1");
    expect(onClose).toHaveBeenCalledOnce();
    expect(onRebuilt).not.toHaveBeenCalled();
  });

  it("连接类查询失败走浮层、页脚换装「重新查询」，重查不再次提交", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getTask).mockRejectedValueOnce(
      new ApiError("network", "连不上后端", 0, null),
    );
    const { onRebuilt } = renderDialog();
    await user.click(footerButton("重建导入记录"));
    await screen.findByText("正在重建");

    expect(await screen.findByText("连不上后端")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onRebuilt).not.toHaveBeenCalled();
    expect(footerButton("取消")).toBeDisabled();
    await user.click(footerButton("重新查询"));

    expect(await screen.findByText("重建完成 · 登记素材 3 条")).toBeInTheDocument();
    expect(api.rebuildImportRecords).toHaveBeenCalledOnce();
    expect(api.getTask).toHaveBeenNthCalledWith(2, "rebuild-1");
  });

  it("非连接类查询失败落就地红字＋句末刷新钮，页脚保持状态槽与两钮禁用", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getTask).mockRejectedValueOnce(
      new ApiError("http", "服务端内部错误", 500, null),
    );
    renderDialog();
    await user.click(footerButton("重建导入记录"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "进度查询失败——服务端内部错误；任务可能仍在运行，请稍后重试。",
    );
    expect(footerButton("取消")).toBeDisabled();
    expect(footerButton("重建导入记录")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "重新查询" }));

    expect(await screen.findByText("重建完成 · 登记素材 3 条")).toBeInTheDocument();
  });

  it("任务丢失只说「任务已丢失，请重试」，可直接再投", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getTask).mockRejectedValueOnce(
      new ApiError("http", "查无此任务", 404, null),
    );
    const { onRebuilt } = renderDialog();
    await user.click(footerButton("重建导入记录"));

    expect(await screen.findByRole("alert")).toHaveTextContent("任务已丢失，请重试");
    expect(onRebuilt).toHaveBeenCalledOnce();
    await user.click(footerButton("重建导入记录"));

    expect(api.rebuildImportRecords).toHaveBeenCalledTimes(2);
  });

  it("失败终态展示原因而不宣称重建成功", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getTask).mockResolvedValue({
      ...succeeded,
      status: "failed",
      result: null,
      error: "存在格式不同的同名文件，无法重建导入记录。",
    });
    const { onClose, onRebuilt } = renderDialog();

    await user.click(footerButton("重建导入记录"));

    expect(await screen.findByRole("alert")).toHaveTextContent("同名文件，无法重建");
    expect(onClose).not.toHaveBeenCalled();
    expect(onRebuilt).toHaveBeenCalledOnce();
    expect(screen.queryByText(/重建完成/)).not.toBeInTheDocument();
  });

  it("卸载后迟到的成功响应不再通知旧目录刷新", async () => {
    const user = userEvent.setup();
    let finish: ((value: TaskView) => void) | undefined;
    vi.mocked(api.getTask).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { onRebuilt, onClose, unmount } = renderDialog();
    await user.click(footerButton("重建导入记录"));
    await screen.findByText("正在重建");

    unmount();
    await act(async () => {
      finish?.(succeeded);
    });

    expect(onRebuilt).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText(/重建完成/)).not.toBeInTheDocument();
  });
});
