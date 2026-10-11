import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../../../api";
import { DeleteWorkdirDialog } from "./DeleteWorkdirDialog";

vi.mock("../../../api", async (original) => ({
  ...(await original<typeof import("../../../api")>()),
  api: { previewWorkdirDeletion: vi.fn(), deleteWorkdir: vi.fn() },
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.previewWorkdirDeletion).mockResolvedValue({
    path: "/srv/original",
    file_count: 9,
    total_bytes: 2097152,
    original_materials: true,
    confirmation: "此工作目录即原始素材目录，删除后不可恢复。",
  });
});

it("标题带对象名、范围并为一行，确认后提交预览路径，真正成功才退出", async () => {
  const user = userEvent.setup();
  const deleted = vi.fn();
  const closed = vi.fn();
  vi.mocked(api.deleteWorkdir).mockResolvedValue({
    deleted: true,
    remaining_path: null,
  });
  render(
    <DeleteWorkdirDialog
      wid="w1"
      name="原素材目录"
      onClose={closed}
      onDeleted={deleted}
    />,
  );

  expect(await screen.findByText("删除工作目录「原素材目录」？")).toBeVisible();
  // 路径与「N 个文件 · 体积」并成一行（稿正文两行合并），风险句另起一行。
  expect(
    screen.getByText("/srv/original · 9 个文件 · 2.00 MB", { exact: false }),
  ).toBeVisible();
  expect(screen.getByText("此工作目录即原始素材目录，删除后不可恢复。")).toBeVisible();
  expect(screen.getByText("此操作不可撤销")).toBeVisible();
  expect(api.deleteWorkdir).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "确认删除" }));

  expect(api.deleteWorkdir).toHaveBeenCalledExactlyOnceWith("w1", "/srv/original");
  expect(deleted).toHaveBeenCalledOnce();
  // 成功只报宿主出口（onDeleted→回主页），撤窗由宿主做——本件不越权关自己。
  expect(closed).not.toHaveBeenCalled();
});

it("残留尾态给单句真话且确认钮禁用，重试＝关窗后重开即重新取范围", async () => {
  const user = userEvent.setup();
  const deleted = vi.fn();
  const closed = vi.fn();
  vi.mocked(api.deleteWorkdir).mockResolvedValue({
    deleted: false,
    remaining_path: "/srv/original",
  });
  const rendered = render(
    <DeleteWorkdirDialog
      wid="w1"
      name="原素材目录"
      onClose={closed}
      onDeleted={deleted}
    />,
  );
  await screen.findByText("/srv/original · 9 个文件 · 2.00 MB", { exact: false });
  await user.click(screen.getByRole("button", { name: "确认删除" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "删除未完成，残留目录：/srv/original。",
  );
  expect(screen.getByRole("alert").textContent).not.toContain("可重新查看");
  expect(screen.getByRole("button", { name: "确认删除" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "重新查看" })).not.toBeInTheDocument();
  expect(deleted).not.toHaveBeenCalled();

  // 撤下「重新查看」钮后，重试出路＝退出后重开：重新挂载即再取一次范围。
  rendered.unmount();
  render(
    <DeleteWorkdirDialog
      wid="w1"
      name="原素材目录"
      onClose={closed}
      onDeleted={deleted}
    />,
  );

  expect(api.previewWorkdirDeletion).toHaveBeenCalledTimes(2);
  expect(
    await screen.findByText("/srv/original · 9 个文件 · 2.00 MB", { exact: false }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "确认删除" })).toBeEnabled();
});

it("飞行期照常可退，迟到回包仍把成功出口交给宿主", async () => {
  let resolveDelete!: (value: {
    deleted: boolean;
    remaining_path: string | null;
  }) => void;
  vi.mocked(api.deleteWorkdir).mockReturnValue(
    new Promise((done) => {
      resolveDelete = done;
    }),
  );
  const user = userEvent.setup();
  const deleted = vi.fn();
  const closed = vi.fn();
  const rendered = render(
    <DeleteWorkdirDialog
      wid="w1"
      name="原素材目录"
      onClose={closed}
      onDeleted={deleted}
    />,
  );
  await screen.findByText("/srv/original · 9 个文件 · 2.00 MB", { exact: false });

  await user.click(screen.getByRole("button", { name: "确认删除" }));
  const cancel = screen.getByRole("button", { name: "取消" });
  expect(cancel).toHaveAttribute("aria-disabled", "true");
  await user.keyboard("{Escape}");

  expect(closed).toHaveBeenCalledOnce();
  // 宿主随 onClose 撤窗＝窗已不在，回包才来——成功出口仍须走到（不然停在已删目录的设置页）。
  rendered.unmount();
  await act(async () => {
    resolveDelete({ deleted: true, remaining_path: null });
  });

  expect(deleted).toHaveBeenCalledOnce();
});
