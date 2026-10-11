import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../../../api";
import { RemoveUnimportedDialog } from "./RemoveUnimportedDialog";

vi.mock("../../../api", () => ({
  // 分流要靠 ApiError 判连接类：假面里没有它，instanceof 会抛 TypeError、症状像「找不到元素」。
  ApiError: class extends Error {},
  errorMessage: (error: unknown) => String(error),
  api: { removeUnimported: vi.fn() },
}));
beforeEach(() => vi.clearAllMocks());

it("确认窗＝标题带对象名、正文一句永久删除，取消不提交", async () => {
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(
    <RemoveUnimportedDialog
      wid="one"
      name="a.jpg"
      onClose={onClose}
      onRemoved={vi.fn()}
    />,
  );

  const dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByRole("heading")).toHaveTextContent("删除未导入文件「a.jpg」？");
  expect(dialog.getByText("此文件将从本地永久删除。")).toBeInTheDocument();
  expect(dialog.queryByText("a.jpg", { exact: true })).not.toBeInTheDocument();
  await user.click(dialog.getByRole("button", { name: "取消" }));

  expect(onClose).toHaveBeenCalledOnce();
  expect(api.removeUnimported).not.toHaveBeenCalled();
});

it("成功即关窗并回调刷新，不再有待恢复路径的结果步", async () => {
  const onClose = vi.fn();
  const onRemoved = vi.fn();
  vi.mocked(api.removeUnimported).mockResolvedValue({
    count: 1,
    recovery_path: null,
  });
  const user = userEvent.setup();
  render(
    <RemoveUnimportedDialog
      wid="one"
      name="a.jpg"
      onClose={onClose}
      onRemoved={onRemoved}
    />,
  );

  await user.click(screen.getByRole("button", { name: "删除" }));

  expect(api.removeUnimported).toHaveBeenCalledWith("one", ["a.jpg"]);
  expect(onRemoved).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("请求失败给就地红字并保持窗开着可重试", async () => {
  vi.mocked(api.removeUnimported).mockRejectedValueOnce(new Error("目录正在导入"));
  const onRemoved = vi.fn();
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(
    <RemoveUnimportedDialog
      wid="one"
      name="a.jpg"
      onClose={onClose}
      onRemoved={onRemoved}
    />,
  );

  await user.click(screen.getByRole("button", { name: "删除" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("目录正在导入");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
  expect(onRemoved).not.toHaveBeenCalled();
});

it("飞行期关窗与 Esc 照常可退，退出等于离开界面不撤销请求", async () => {
  let resolve!: (value: { count: number; recovery_path: string | null }) => void;
  vi.mocked(api.removeUnimported).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(
    <RemoveUnimportedDialog
      wid="one"
      name="a.jpg"
      onClose={onClose}
      onRemoved={vi.fn()}
    />,
  );
  const dialog = within(screen.getByRole("dialog"));
  await user.click(dialog.getByRole("button", { name: "删除" }));
  // 飞行期两钮只失效不换装（文字仍是「删除」），退出走 Esc／右上角关闭——退出 ≠ 撤销。
  expect(dialog.getByRole("button", { name: "删除" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  expect(dialog.getByRole("button", { name: "取消" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await user.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledOnce();

  await act(async () => resolve({ count: 1, recovery_path: null }));
});

it("卸载后的迟到结果不再回调，避免刷新另一个目录", async () => {
  let resolve!: (value: { count: number; recovery_path: string | null }) => void;
  vi.mocked(api.removeUnimported).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const onRemoved = vi.fn();
  const user = userEvent.setup();
  const rendered = render(
    <RemoveUnimportedDialog
      wid="one"
      name="a.jpg"
      onClose={vi.fn()}
      onRemoved={onRemoved}
    />,
  );
  const dialog = within(screen.getByRole("dialog"));
  await user.click(dialog.getByRole("button", { name: "删除" }));
  rendered.unmount();

  await act(async () => resolve({ count: 1, recovery_path: null }));

  expect(onRemoved).not.toHaveBeenCalled();
});
