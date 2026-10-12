import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ApiError, api, type TaskView } from "../../../api";
import { ToastViewport } from "../../../components/ui/toast";
import { getToastSnapshot, removeToast } from "../../../lib/toast";
import { ImportMaterialsDialog } from "./ImportMaterialsDialog";

vi.mock("../../../api", async (original) => ({
  ...(await original<typeof import("../../../api")>()),
  api: {
    importMaterials: vi.fn(),
    importPreview: vi.fn(),
    scanPreview: vi.fn(),
    getTask: vi.fn(),
    cancelTask: vi.fn(),
  },
}));

const running: TaskView = {
  id: "task",
  status: "running",
  progress: 0.4,
  result: null,
  error: null,
};
const completed: TaskView = {
  id: "task",
  status: "succeeded",
  progress: 1,
  result: {
    source: "/source",
    imported: ["new.jpg"],
    imported_images: 1,
    imported_videos: 0,
    skipped_identical: [],
    skipped_conflict: [],
    skipped_duplicate: [],
    rejected: [],
  },
  error: null,
};

/** 页脚钮（壳的关闭叉与页脚「关闭」同名，取页脚那枚免撞严格模式）。 */
function footerButton(name: string): HTMLElement {
  const footer = document.querySelector<HTMLElement>('[data-slot="dialog-footer"]');
  if (!footer) throw new Error("弹窗页脚未渲染");
  return within(footer).getByRole("button", { name });
}

/** 渲染弹窗（附带浮层出口——完成汇报与连接类失败都落那里）。 */
function renderDialog(props?: { initialMode?: "copy" | "inplace" }) {
  const onClose = vi.fn();
  const onImported = vi.fn();
  render(
    <>
      <ImportMaterialsDialog
        wid="work"
        workdirPath={"D:\\df-work\\人物校服"}
        onClose={onClose}
        onImported={onImported}
        initialMode={props?.initialMode}
      />
      <ToastViewport />
    </>,
  );
  return { onClose, onImported };
}

/** 就地形态的在盘文件清单：只有「未登记」那类进可导入列表。 */
function buildScan(items: { name: string; reason: string }[]) {
  return {
    total: 0,
    images: 0,
    videos: 0,
    unimported: items.map((item) => ({
      name: item.name,
      media: "image",
      reason: item.reason,
      size: 1024,
      limit: null,
    })),
  };
}

function unimported(...items: { name: string; reason: string }[]) {
  return buildScan(items);
}

beforeEach(() => {
  vi.resetAllMocks();
  // 浮层是模块级存储，驻留 5s——不清就会跨用例串台。
  for (const item of getToastSnapshot()) removeToast(item.id);
  vi.mocked(api.importMaterials).mockResolvedValue({ task_id: "task" });
  vi.mocked(api.getTask).mockResolvedValue(completed);
  vi.mocked(api.scanPreview).mockResolvedValue(
    unimported(
      { name: "a.jpg", reason: "未登记" },
      { name: "b.jpg", reason: "未登记" },
    ),
  );
  vi.mocked(api.importPreview).mockResolvedValue({
    files: [{ name: "c.jpg", size: 2048 }],
  });
});

it("就地形态打开即自查，清单只列未登记的可导入文件", async () => {
  vi.mocked(api.scanPreview).mockResolvedValue(
    unimported(
      { name: "a.jpg", reason: "未登记" },
      { name: "note.txt", reason: "扩展名不支持" },
      { name: "big.mp4", reason: "超出大小上限" },
    ),
  );

  renderDialog();

  expect(await screen.findByText("a.jpg")).toBeInTheDocument();
  expect(screen.queryByText("note.txt")).not.toBeInTheDocument();
  expect(screen.queryByText("big.mp4")).not.toBeInTheDocument();
  expect(footerButton("导入")).toBeEnabled();
});

it("就地没有可导入文件时给空态句并禁用主钮", async () => {
  vi.mocked(api.scanPreview).mockResolvedValue(unimported());

  renderDialog();

  expect(await screen.findByText("没有可以导入的文件")).toBeInTheDocument();
  expect(footerButton("导入")).toBeDisabled();
});

it("就地读取失败给红字与页脚重新读取，重读成功回常态且不自动导入", async () => {
  const user = userEvent.setup();
  vi.mocked(api.scanPreview).mockRejectedValueOnce(new Error("工作目录读取失败"));

  renderDialog();

  expect(await screen.findByRole("alert")).toHaveTextContent("工作目录读取失败");
  expect(screen.queryByRole("button", { name: "导入" })).not.toBeInTheDocument();
  await user.click(footerButton("重新读取"));

  expect(await screen.findByText("a.jpg")).toBeInTheDocument();
  expect(api.importMaterials).not.toHaveBeenCalled();
});

it("复制形态先扫描：来源为空不亮，扫完换装导入并列即将导入的文件", async () => {
  const user = userEvent.setup();
  renderDialog({ initialMode: "copy" });

  expect(footerButton("扫描")).toBeDisabled();
  await user.type(screen.getByRole("textbox", { name: "来源" }), "/source");
  await user.click(footerButton("扫描"));

  expect(await screen.findByText("c.jpg")).toBeInTheDocument();
  expect(api.importPreview).toHaveBeenCalledExactlyOnceWith("work", "/source");
  expect(api.importMaterials).not.toHaveBeenCalled();
  await user.click(footerButton("导入"));

  expect(api.importMaterials).toHaveBeenCalledExactlyOnceWith("work", {
    source: "/source",
  });
});

it("改动来源即作废扫描结果，主钮退回扫描且来源为空时不亮", async () => {
  const user = userEvent.setup();
  renderDialog({ initialMode: "copy" });
  await user.type(screen.getByRole("textbox", { name: "来源" }), "/source");
  await user.click(footerButton("扫描"));
  await screen.findByText("c.jpg");

  await user.clear(screen.getByRole("textbox", { name: "来源" }));

  expect(screen.queryByText("c.jpg")).not.toBeInTheDocument();
  expect(footerButton("扫描")).toBeDisabled();
  await user.type(screen.getByRole("textbox", { name: "来源" }), "/other");

  expect(footerButton("扫描")).toBeEnabled();
});

it("复制形态扫描无结果时列空态且导入不亮", async () => {
  const user = userEvent.setup();
  vi.mocked(api.importPreview).mockResolvedValue({ files: [] });
  renderDialog({ initialMode: "copy" });
  await user.type(screen.getByRole("textbox", { name: "来源" }), "/source");

  await user.click(footerButton("扫描"));

  expect(await screen.findByText("没有可以导入的文件")).toBeInTheDocument();
  expect(footerButton("导入")).toBeDisabled();
});

it("扫描失败就地给后端真话，主钮仍是可点的扫描并可重试", async () => {
  const user = userEvent.setup();
  vi.mocked(api.importPreview).mockRejectedValueOnce(
    new Error("来源目录「/nope」不存在或不是目录——请检查后重试。"),
  );
  renderDialog({ initialMode: "copy" });
  await user.type(screen.getByRole("textbox", { name: "来源" }), "/nope");
  await user.click(footerButton("扫描"));

  expect(await screen.findByRole("alert")).toHaveTextContent("不存在或不是目录");
  expect(footerButton("扫描")).toBeEnabled();
  await user.click(footerButton("扫描"));

  expect(await screen.findByText("c.jpg")).toBeInTheDocument();
  expect(api.importPreview).toHaveBeenCalledTimes(2);
});

it("导入成功自动关窗，完成与各类跳过逐条浮现为浮层", async () => {
  vi.mocked(api.getTask).mockResolvedValue({
    ...completed,
    result: {
      source: "/source",
      imported: ["new.jpg"],
      imported_images: 1,
      imported_videos: 0,
      skipped_identical: ["a.jpg", "b.jpg", "c.jpg"],
      skipped_conflict: [
        {
          name: "d.jpg",
          existing_size: 1,
          incoming_size: 2,
          existing_sha256: "e".repeat(64),
          incoming_sha256: "f".repeat(64),
        },
      ],
      skipped_duplicate: [],
      rejected: [{ name: "note.txt", reason: "扩展名不支持" }],
    },
  });
  const { onClose, onImported } = renderDialog();

  await userEvent.setup().click(footerButton("导入"));

  expect(await screen.findByText("导入完成 · 新增 1 项")).toBeInTheDocument();
  expect(
    screen.getByText("已跳过完全相同的文件：a.jpg、b.jpg 等 3 项"),
  ).toBeInTheDocument();
  expect(
    screen.getByText("已跳过文件名相同但内容不同的文件：d.jpg"),
  ).toBeInTheDocument();
  expect(screen.getByText("已跳过不支持的文件：note.txt")).toBeInTheDocument();
  expect(onClose).toHaveBeenCalledOnce();
  expect(onImported).toHaveBeenCalledOnce();
});

it("飞行期表单只失效不换装，页脚给取消导入且关闭照常可退", async () => {
  const user = userEvent.setup();
  vi.mocked(api.getTask).mockImplementation(() => new Promise(() => {}));
  const { onClose } = renderDialog();
  await user.click(footerButton("导入"));
  await screen.findByText("正在导入 · 0%");

  expect(screen.getByRole("tablist")).toHaveAttribute("aria-disabled", "true");
  expect(footerButton("取消导入")).toBeEnabled();
  await user.click(footerButton("关闭"));

  expect(onClose).toHaveBeenCalledOnce();
  expect(api.cancelTask).not.toHaveBeenCalled();
});

it("点取消导入发取消并转「正在取消」，该钮只失效不换装", async () => {
  const user = userEvent.setup();
  vi.mocked(api.getTask)
    .mockResolvedValueOnce(running)
    .mockResolvedValue({ ...running, progress: 0.6 });
  vi.mocked(api.cancelTask).mockResolvedValue(running);
  const { onClose } = renderDialog();
  await user.click(footerButton("导入"));
  await screen.findByText("正在导入 · 40%");

  await user.click(footerButton("取消导入"));

  expect(api.cancelTask).toHaveBeenCalledExactlyOnceWith("task");
  expect(await screen.findByText("正在取消 · 60%")).toBeInTheDocument();
  expect(footerButton("取消导入")).toHaveAttribute("aria-disabled", "true");
  expect(onClose).not.toHaveBeenCalled();
});

it("取消成功回常态给红字「导入已取消」，不关窗", async () => {
  vi.mocked(api.getTask).mockResolvedValue({
    ...completed,
    status: "cancelled",
    result: null,
    error: null,
  });
  const { onClose, onImported } = renderDialog();

  await userEvent.setup().click(footerButton("导入"));

  expect(await screen.findByRole("alert")).toHaveTextContent("导入已取消");
  expect(onClose).not.toHaveBeenCalled();
  expect(onImported).toHaveBeenCalledOnce();
});

it("连接类查询失败走浮层并换装重新查询，重查成功回飞行态", async () => {
  const user = userEvent.setup();
  vi.mocked(api.getTask)
    .mockRejectedValueOnce(new ApiError("network", "连不上后端", 0, null))
    .mockResolvedValue(running);
  renderDialog();
  await user.click(footerButton("导入"));

  expect(await screen.findByText("连不上后端")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByText(/正在导入 ·/)).not.toBeInTheDocument();
  await user.click(footerButton("重新查询"));

  expect(await screen.findByText("正在导入 · 40%")).toBeInTheDocument();
  expect(footerButton("取消导入")).toBeInTheDocument();
  expect(api.importMaterials).toHaveBeenCalledOnce();
});

it("非连接类查询失败落就地红字＋句末刷新钮，页脚仍是取消导入", async () => {
  const user = userEvent.setup();
  vi.mocked(api.getTask)
    .mockRejectedValueOnce(new ApiError("http", "服务端内部错误", 500, null))
    .mockResolvedValue(running);
  renderDialog();
  await user.click(footerButton("导入"));

  expect(await screen.findByRole("alert")).toHaveTextContent("服务端内部错误");
  expect(screen.queryByText(/正在导入 ·/)).not.toBeInTheDocument();
  expect(footerButton("取消导入")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "重新查询" }));

  expect(await screen.findByText("正在导入 · 40%")).toBeInTheDocument();
});

it("轮询 404 报任务进度丢失，以现值重投不重走选目录", async () => {
  const user = userEvent.setup();
  vi.mocked(api.getTask)
    .mockRejectedValueOnce(new ApiError("http", "任务不存在", 404, null))
    .mockResolvedValue(completed);
  renderDialog({ initialMode: "copy" });
  await user.type(screen.getByRole("textbox", { name: "来源" }), "/source");
  await user.click(footerButton("扫描"));
  await screen.findByText("c.jpg");
  await user.click(footerButton("导入"));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "任务进度丢失，请重新执行导入",
  );
  expect(footerButton("导入")).toBeEnabled();
  await user.click(footerButton("导入"));

  expect(api.importMaterials).toHaveBeenCalledTimes(2);
  expect(api.importPreview).toHaveBeenCalledOnce();
});

it("导入失败留红字与清单，可改来源再投", async () => {
  const user = userEvent.setup();
  vi.mocked(api.getTask).mockResolvedValue({
    ...completed,
    status: "failed",
    result: null,
    error: "已有导入在跑，请稍后再试",
  });
  const { onClose } = renderDialog({ initialMode: "copy" });
  await user.type(screen.getByRole("textbox", { name: "来源" }), "/source");
  await user.click(footerButton("扫描"));
  await screen.findByText("c.jpg");

  await user.click(footerButton("导入"));

  expect(await screen.findByRole("alert")).toHaveTextContent("已有导入在跑");
  expect(screen.getByText("c.jpg")).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
});

it("成功载荷畸形时报结果格式异常，不关窗也不报完成", async () => {
  vi.mocked(api.getTask).mockResolvedValue({ ...completed, result: {} });
  const { onClose, onImported } = renderDialog();

  await userEvent.setup().click(footerButton("导入"));

  expect(await screen.findByRole("alert")).toHaveTextContent("导入结果格式异常");
  expect(onClose).not.toHaveBeenCalled();
  expect(onImported).toHaveBeenCalledOnce();
  expect(screen.queryByText(/导入完成/)).not.toBeInTheDocument();
});

it("标题行给工作目录真值，死文案副题已撤且就地为默认档", async () => {
  renderDialog();

  expect(await screen.findByText("D:\\df-work\\人物校服")).toBeInTheDocument();
  expect(screen.queryByText("当前工作目录")).not.toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "就地导入" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});
