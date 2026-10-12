import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { api, type TaskView } from "../../../api";
import type { components } from "../../../api-types.gen";
import { CleanupDialog } from "./CleanupDialog";

vi.mock("../../../api", async (original) => ({
  ...(await original<typeof import("../../../api")>()),
  api: {
    previewProductCleanup: vi.fn(),
    startCleanupInvalid: vi.fn(),
    getTask: vi.fn(),
  },
}));

type InvalidFile = components["schemas"]["InvalidFile"];

function file(name: string, size: number, batch: number | null = null): InvalidFile {
  return { name, size, reason: batch === null ? "扩展名不支持" : "无配对产物", batch };
}

const accepted: TaskView = {
  id: "cleanup-1",
  status: "running",
  progress: 0.4,
  error: null,
  result: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.previewProductCleanup).mockResolvedValue({
    products: [file("s1__lost.txt", 1024, 1), file("s2__other.txt", 2048, 2)],
    unsupported: [file("design.psd", 4096)],
    oversize: [],
    total_bytes: 7168,
  });
  vi.mocked(api.startCleanupInvalid).mockResolvedValue({ task_id: "cleanup-1" });
  vi.mocked(api.getTask).mockResolvedValue({
    ...accepted,
    status: "succeeded",
    progress: 1,
    result: { count: 3, recovery_path: null },
  });
});

function renderDialog(
  overrides: {
    onClose?: () => void;
    onCleaned?: () => void;
    onBackground?: (taskId: string) => void;
  } = {},
) {
  render(
    <CleanupDialog
      wid="w1"
      onClose={overrides.onClose ?? vi.fn()}
      onCleaned={overrides.onCleaned ?? vi.fn()}
      onBackground={overrides.onBackground ?? vi.fn()}
    />,
  );
}

it("只读扫场：三类各一表、行尾带体积与策略号，页脚取消＋全部清理", async () => {
  renderDialog();
  const dialog = await screen.findByRole("dialog", { name: "清理无效文件" });

  expect(within(dialog).getByRole("button", { name: /^无配对产物/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  expect(within(dialog).getByText("不支持的文件")).toBeVisible();
  expect(within(dialog).queryByText("超限的文件")).not.toBeInTheDocument();
  expect(within(dialog).getByText("s1__lost.txt")).toBeVisible();
  expect(within(dialog).getByText("1.0 KB · s1")).toBeVisible();
  expect(within(dialog).getByText("4.0 KB")).toBeVisible();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  // 「清理后不可恢复」常驻标题行右侧（九改撤二次确认的承载位）。
  expect(within(dialog).getByText("清理后不可恢复")).toBeVisible();
  expect(within(dialog).getByRole("button", { name: "全部清理" })).toBeEnabled();
});

it("全部清理一步执行：受理即切进度行，完成自动关窗并刷新宿主", async () => {
  const user = userEvent.setup();
  const cleaned = vi.fn();
  const close = vi.fn();
  renderDialog({ onCleaned: cleaned, onClose: close });

  await user.click(await screen.findByRole("button", { name: "全部清理" }));

  expect(api.startCleanupInvalid).toHaveBeenCalledExactlyOnceWith("w1", [
    "s1__lost.txt",
    "s2__other.txt",
    "design.psd",
  ]);
  expect(cleaned).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});

it("受理被拒给一行红字、弹窗不关，可就地重试", async () => {
  const user = userEvent.setup();
  const close = vi.fn();
  vi.mocked(api.startCleanupInvalid).mockRejectedValueOnce(
    new Error("文件列表已过期，请重新进入。"),
  );
  renderDialog({ onClose: close });

  await user.click(await screen.findByRole("button", { name: "全部清理" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("文件列表已过期");
  expect(close).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "全部清理" }));

  expect(api.startCleanupInvalid).toHaveBeenCalledTimes(2);
});

it("清理在飞：清单留守、两钮只失效，关闭叉可退且把句柄交宿主", async () => {
  const user = userEvent.setup();
  const close = vi.fn();
  const background = vi.fn();
  vi.mocked(api.getTask).mockResolvedValue(accepted);
  renderDialog({ onClose: close, onBackground: background });

  await user.click(await screen.findByRole("button", { name: "全部清理" }));

  expect(await screen.findByText(/^正在清理 · /)).toBeVisible();
  expect(screen.getByText(/40%/)).toBeVisible();
  expect(screen.getByText("s1__lost.txt")).toBeVisible();
  const cancel = screen.getByRole("button", { name: "取消" });
  expect(cancel).toHaveAttribute("aria-disabled", "true");
  expect(screen.getByRole("button", { name: "正在清理" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );

  await user.click(screen.getByRole("button", { name: "关闭" }));

  expect(background).toHaveBeenCalledExactlyOnceWith("cleanup-1");
  expect(close).toHaveBeenCalledOnce();
});

it("表题整行可点折叠，折上的组不占清单额度", async () => {
  const user = userEvent.setup();
  renderDialog();

  const caption = await screen.findByRole("button", { name: /^无配对产物/ });
  await user.click(caption);

  expect(caption).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText("s1__lost.txt")).not.toBeInTheDocument();
  expect(screen.getByText("design.psd")).toBeVisible();

  await user.click(caption);

  expect(caption).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("s1__lost.txt")).toBeVisible();
});

it("空态给一行说明、主钮恒在但禁用", async () => {
  vi.mocked(api.previewProductCleanup).mockResolvedValue({
    products: [],
    unsupported: [],
    oversize: [],
    total_bytes: 0,
  });
  renderDialog();

  expect(await screen.findByText("没有可清理的项目")).toBeVisible();
  expect(screen.getByRole("button", { name: "全部清理" })).toBeDisabled();
});

it("预览失败红字＋页脚「重新读取」，读成后才给清理动作", async () => {
  const user = userEvent.setup();
  vi.mocked(api.previewProductCleanup).mockRejectedValueOnce(
    new Error("工作目录不存在，请检查路径后重试。"),
  );
  renderDialog();

  expect(await screen.findByRole("alert")).toHaveTextContent("工作目录不存在");
  expect(screen.queryByRole("button", { name: "全部清理" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "重新读取" }));

  expect(await screen.findByRole("button", { name: "全部清理" })).toBeEnabled();
  expect(api.previewProductCleanup).toHaveBeenCalledTimes(2);
});

it("清单区限高按弹性分配：短组完整、长组吃剩余份额并自然裁切", async () => {
  const products = Array.from({ length: 11 }, (_item, index) =>
    file(`s1__p${index}.txt`, 100, 1),
  );
  const unsupported = Array.from({ length: 3 }, (_item, index) =>
    file(`u${index}.psd`, 100),
  );
  const oversize = Array.from({ length: 2 }, (_item, index) =>
    file(`o${index}.mov`, 100),
  );
  vi.mocked(api.previewProductCleanup).mockResolvedValue({
    products,
    unsupported,
    oversize,
    total_bytes: 1600,
  });
  renderDialog();

  const caption = await screen.findByRole("button", { name: /^无配对产物/ });
  const box = caption.nextElementSibling;

  expect(box).not.toBeNull();
  // 11／3／2 三组：短组 2、3 行完整放行，剩下的 4 行额度给最长的这一组（稿格 4 同例）。
  expect(box).toHaveStyle({ maxHeight: "152px" });
  expect(
    screen.getByRole("button", { name: /^超限的文件/ }).nextElementSibling,
  ).not.toHaveStyle({ maxHeight: "152px" });
});
