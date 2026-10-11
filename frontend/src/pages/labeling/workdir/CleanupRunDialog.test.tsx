import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../../../api";
import { CleanupRunDialog } from "./CleanupRunDialog";

vi.mock("../../../api", async (original) => ({
  ...(await original<typeof import("../../../api")>()),
  api: {
    previewRunCleanup: vi.fn(),
    cleanupWorkdir: vi.fn(),
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.previewRunCleanup).mockResolvedValue([
    { name: "20261012-010000-a1b2c3", size: 4096, modified_at: 1762000000 },
  ]);
});

it("解释确认窗给出这份记录的信息与后果，一步直发清理后自动关窗", async () => {
  const cleaned = vi.fn();
  const closed = vi.fn();
  vi.mocked(api.cleanupWorkdir).mockResolvedValue({ count: 1, recovery_path: null });
  const user = userEvent.setup();
  render(
    <CleanupRunDialog
      wid="w1"
      run="20261012-010000-a1b2c3"
      onClose={closed}
      onCleaned={cleaned}
    />,
  );

  const dialog = within(screen.getByRole("dialog"));
  expect(
    await dialog.findByText("20261012-010000-a1b2c3 · 4.0 KB", { exact: false }),
  ).toBeInTheDocument();
  expect(dialog.getByText("清理后不可恢复")).toBeInTheDocument();
  expect(dialog.getByText("清理后")).toBeInTheDocument();
  expect(dialog.getByText("不受影响")).toBeInTheDocument();

  await user.click(dialog.getByRole("button", { name: "清理这份记录" }));

  expect(api.cleanupWorkdir).toHaveBeenCalledExactlyOnceWith("w1", "runs", [
    "20261012-010000-a1b2c3",
  ]);
  expect(cleaned).toHaveBeenCalledOnce();
  expect(closed).toHaveBeenCalledOnce();
});

it("取数中只有取消钮、无主钮", async () => {
  vi.mocked(api.previewRunCleanup).mockReturnValue(new Promise(() => {}));
  render(
    <CleanupRunDialog
      wid="w1"
      run="20261012-010000-a1b2c3"
      onClose={vi.fn()}
      onCleaned={vi.fn()}
    />,
  );

  const dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByRole("status")).toHaveTextContent("正在读取记录信息");
  expect(dialog.getByRole("button", { name: "取消" })).toBeInTheDocument();
  expect(dialog.queryByText("清理这份记录")).not.toBeInTheDocument();
});

it("预览里已经没有这一份＝取数失败，句按稿定、出口是重新读取", async () => {
  const user = userEvent.setup();
  render(
    <CleanupRunDialog
      wid="w1"
      run="20260101-000000-gone"
      onClose={vi.fn()}
      onCleaned={vi.fn()}
    />,
  );

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "运行记录已变化，请重新进入。",
  );
  expect(screen.getByRole("button", { name: "重新读取" })).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "清理这份记录" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "重新读取" }));
  expect(api.previewRunCleanup).toHaveBeenCalledTimes(2);
});

it("清理失败就地给红字且解释区保持在场，可再点同一出口重试", async () => {
  const closed = vi.fn();
  vi.mocked(api.cleanupWorkdir)
    .mockRejectedValueOnce(new Error("运行记录已变化，请重新进入。"))
    .mockResolvedValueOnce({ count: 1, recovery_path: null });
  const user = userEvent.setup();
  render(
    <CleanupRunDialog
      wid="w1"
      run="20261012-010000-a1b2c3"
      onClose={closed}
      onCleaned={vi.fn()}
    />,
  );

  const dialog = within(screen.getByRole("dialog"));
  await dialog.findByText("20261012-010000-a1b2c3 · 4.0 KB", { exact: false });
  await user.click(dialog.getByRole("button", { name: "清理这份记录" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("运行记录已变化");
  expect(dialog.getByText("不受影响")).toBeInTheDocument();
  expect(closed).not.toHaveBeenCalled();

  await user.click(dialog.getByRole("button", { name: "清理这份记录" }));
  expect(closed).toHaveBeenCalledOnce();
});

it("清理飞行期取消钮只失效不换装，Esc 照常退出不撤销清理", async () => {
  const closed = vi.fn();
  const cleaned = vi.fn();
  vi.mocked(api.previewRunCleanup).mockResolvedValue([
    { name: "r1", size: 1024, modified_at: 1762000000 },
  ]);
  vi.mocked(api.cleanupWorkdir).mockImplementation(() => new Promise(() => {}));
  const user = userEvent.setup();
  render(<CleanupRunDialog wid="w1" run="r1" onClose={closed} onCleaned={cleaned} />);

  const dialog = within(screen.getByRole("dialog"));
  await dialog.findByText("r1 · 1.0 KB", { exact: false });
  await user.click(dialog.getByRole("button", { name: "清理这份记录" }));

  expect(dialog.getByRole("button", { name: "正在清理" })).toBeInTheDocument();
  const cancel = dialog.getByRole("button", { name: "取消" });
  expect(cancel).toHaveAttribute("aria-disabled", "true");
  await user.click(cancel);
  expect(closed).not.toHaveBeenCalled();

  await user.keyboard("{Escape}");
  expect(closed).toHaveBeenCalledOnce();
  expect(cleaned).not.toHaveBeenCalled();
});

it("记录已移出但暂存没清空＝残留尾态，路径留给用户手动处理", async () => {
  vi.mocked(api.cleanupWorkdir).mockResolvedValue({
    count: 1,
    recovery_path: "/w1/.dsf/trash/token123",
  });
  const closed = vi.fn();
  const user = userEvent.setup();
  render(
    <CleanupRunDialog
      wid="w1"
      run="20261012-010000-a1b2c3"
      onClose={closed}
      onCleaned={vi.fn()}
    />,
  );

  await user.click(await screen.findByRole("button", { name: "清理这份记录" }));

  expect(await screen.findByRole("status")).toHaveTextContent(
    "运行记录已清理，暂存目录清理时遇到问题",
  );
  expect(screen.getByText("/w1/.dsf/trash/token123")).toBeInTheDocument();
  expect(closed).not.toHaveBeenCalled();
  // 页脚关闭钮排在角叉之前（DialogContent 先渲染 children／页脚，关闭钮在其后）。
  const closeButtons = screen.getAllByRole("button", { name: "关闭" });
  const footerClose = closeButtons[0];
  if (!footerClose) throw new Error("缺少页脚关闭按钮");
  await user.click(footerClose);
  expect(closed).toHaveBeenCalledOnce();
});
