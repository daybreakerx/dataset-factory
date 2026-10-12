import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api";
import type { components } from "../api-types.gen";
import { DirectoryPicker } from "./DirectoryPicker";

vi.mock("../api", async (original) => ({
  ...(await original<typeof import("../api")>()),
  api: {
    listDirectory: vi.fn(),
    renameDirectory: vi.fn(),
    createDirectory: vi.fn(),
    filesystemCapabilities: vi.fn(),
    openDirectory: vi.fn(),
    getTask: vi.fn(),
  },
}));

type Entry = components["schemas"]["DirectoryEntry"];

const dirEntry: Entry = {
  name: "package",
  path: "/srv/package",
  kind: "directory",
  media: "file",
  is_empty: false,
  modified_at: "2026-09-17T00:00:00Z",
  size: null,
};
const fileEntry: Entry = {
  name: "SKILL.md",
  path: "/srv/SKILL.md",
  kind: "file",
  media: "file",
  is_empty: null,
  modified_at: "2026-09-17T00:00:00Z",
  size: 1024,
};
const listing: components["schemas"]["DirectoryListing"] = {
  hostname: "test-server",
  system: "Linux",
  path: "/srv",
  parent: "/",
  is_empty: false,
  unavailable_count: 0,
  entries: [dirEntry, fileEntry],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.listDirectory).mockResolvedValue(listing);
  vi.mocked(api.filesystemCapabilities).mockResolvedValue({
    open_in_file_manager: false,
  });
});

it("只读浏览仅在后端自报支持时显示系统打开按钮", async () => {
  const user = userEvent.setup();
  vi.mocked(api.filesystemCapabilities).mockResolvedValue({
    open_in_file_manager: true,
  });
  vi.mocked(api.openDirectory).mockResolvedValue(undefined);
  render(<DirectoryPicker browseOnly onClose={vi.fn()} onSelect={vi.fn()} />);
  await screen.findByText("当前后端：test-server · Linux");

  await user.click(
    await screen.findByRole("button", { name: "在系统文件资源管理器中打开" }),
  );

  expect(api.openDirectory).toHaveBeenCalledExactlyOnceWith("/srv");
});

it("单击行＝选中，双击目录才进入；主钮恒亮、目标随选中项换", async () => {
  const user = userEvent.setup();
  const selected = vi.fn();
  render(<DirectoryPicker initialPath="/srv" onClose={vi.fn()} onSelect={selected} />);
  const row = await screen.findByRole("button", { name: "package" });
  // 基础形态无禁用态（稿 #20 格 14 裁）：打开即站在一个目录里，目标＝当前所在目录。
  expect(screen.getByRole("button", { name: "选择此目录" })).toBeEnabled();

  await user.click(row);

  expect(row).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "选择此目录" })).toBeEnabled();
  expect(api.listDirectory).toHaveBeenCalledTimes(1);
  vi.mocked(api.listDirectory).mockResolvedValue({
    ...listing,
    path: "/srv/package",
    parent: "/srv",
    entries: [],
  });

  await user.dblClick(row);

  await screen.findByText("没有匹配的项目");
  expect(api.listDirectory).toHaveBeenLastCalledWith("/srv/package", false, false, []);
  expect(selected).not.toHaveBeenCalled();

  // 走进目录后没有选中行，目标＝当前所在目录——采用出口恒在。
  await user.click(screen.getByRole("button", { name: "选择此目录" }));
  expect(selected).toHaveBeenCalledExactlyOnceWith(
    "/srv/package",
    expect.objectContaining({ path: "/srv/package" }),
  );
});

it("选中行才出「重命名」钮，慢击名字也进原地改名", async () => {
  const user = userEvent.setup();
  render(<DirectoryPicker allowRename onClose={vi.fn()} onSelect={vi.fn()} />);
  await screen.findByRole("button", { name: "package" });
  expect(screen.queryByRole("button", { name: /^重命名/ })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "package" }));
  await user.click(screen.getByRole("button", { name: "重命名" }));

  expect(screen.getByRole("textbox", { name: "重命名 package" })).toHaveValue(
    "package",
  );
});

it("原地改名 Enter 即提交，成功后跳新位置重取", async () => {
  const user = userEvent.setup();
  vi.mocked(api.renameDirectory).mockResolvedValue({ task_id: "rename-task" });
  vi.mocked(api.getTask).mockResolvedValue({
    id: "rename-task",
    status: "succeeded",
    progress: 1,
    error: null,
    result: { path: "/srv/renamed", cleanup_pending: false },
  });
  render(<DirectoryPicker allowRename onClose={vi.fn()} onSelect={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: "package" }));
  await user.click(screen.getByRole("button", { name: "重命名" }));
  const input = screen.getByRole("textbox", { name: "重命名 package" });
  await user.clear(input);
  await user.type(input, "renamed");
  expect(api.renameDirectory).not.toHaveBeenCalled();

  vi.mocked(api.listDirectory).mockResolvedValue({
    ...listing,
    path: "/srv/renamed",
    parent: "/srv",
    entries: [],
  });
  await user.keyboard("{Enter}");
  await screen.findByText("没有匹配的项目");

  expect(api.renameDirectory).toHaveBeenCalledExactlyOnceWith(
    "/srv/package",
    "renamed",
  );
  expect(api.listDirectory).toHaveBeenLastCalledWith("/srv/renamed", false, false, []);
  expect(
    screen.queryByRole("textbox", { name: "重命名 package" }),
  ).not.toBeInTheDocument();
  // 改名后重取的清单里没有选中项：目标回落到当前所在目录（新位置），主钮照常亮。
  expect(screen.getByRole("button", { name: "选择此目录" })).toBeEnabled();
});

it("改名被后端拒绝＝退回旧名并把真话留在原地", async () => {
  const user = userEvent.setup();
  vi.mocked(api.renameDirectory).mockRejectedValue(new Error("目标名称已存在。"));
  render(<DirectoryPicker allowRename onClose={vi.fn()} onSelect={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: "package" }));
  await user.click(screen.getByRole("button", { name: "重命名" }));
  const input = screen.getByRole("textbox", { name: "重命名 package" });
  await user.clear(input);
  await user.type(input, "renamed");
  await user.keyboard("{Enter}");

  expect(await screen.findByRole("alert")).toHaveTextContent("目标名称已存在。");
  expect(
    screen.queryByRole("textbox", { name: "重命名 package" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "package" })).toBeInTheDocument();
});

it("文件行双击＝采用并关窗；只读浏览双击不越界", async () => {
  const user = userEvent.setup();
  const selected = vi.fn();
  const close = vi.fn();
  render(
    <DirectoryPicker
      initialPath="/srv"
      files
      suffixes={[".md"]}
      onClose={close}
      onSelect={selected}
    />,
  );
  await user.dblClick(await screen.findByRole("button", { name: "SKILL.md" }));

  expect(selected).toHaveBeenCalledExactlyOnceWith("/srv/SKILL.md", listing);
  expect(close).not.toHaveBeenCalled();
  expect(api.listDirectory).toHaveBeenLastCalledWith("/srv", true, false, [".md"]);

  const browseClose = vi.fn();
  const browseSelect = vi.fn();
  vi.mocked(api.listDirectory).mockResolvedValue(listing);
  render(
    <DirectoryPicker
      initialPath="/srv"
      browseOnly
      onClose={browseClose}
      onSelect={browseSelect}
    />,
  );
  await user.dblClick(await screen.findByRole("button", { name: "SKILL.md" }));

  expect(browseSelect).not.toHaveBeenCalled();
  expect(browseClose).not.toHaveBeenCalled();
});

it("新建表单单行式：创建经服务器确认后进入新目录，确认选择前不回填", async () => {
  const user = userEvent.setup();
  const selected = vi.fn();
  vi.mocked(api.createDirectory).mockResolvedValue({ path: "/srv/new-parent" });
  render(<DirectoryPicker allowCreate onClose={vi.fn()} onSelect={selected} />);
  await screen.findByText("当前后端：test-server · Linux");

  await user.click(await screen.findByRole("button", { name: "新建目录" }));
  await user.type(screen.getByRole("textbox", { name: "目录名称" }), "new-parent");
  expect(api.createDirectory).not.toHaveBeenCalled();
  vi.mocked(api.listDirectory).mockResolvedValue({
    ...listing,
    path: "/srv/new-parent",
    entries: [{ ...dirEntry, name: "inner", path: "/srv/new-parent/inner" }],
  });
  await user.click(screen.getByRole("button", { name: "创建" }));
  await screen.findByRole("button", { name: "inner" });

  expect(api.createDirectory).toHaveBeenCalledExactlyOnceWith("/srv", "new-parent");
  expect(selected).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "inner" }));
  await user.click(screen.getByRole("button", { name: "选择此目录" }));
  expect(selected).toHaveBeenCalledWith(
    "/srv/new-parent/inner",
    expect.objectContaining({ path: "/srv/new-parent" }),
  );
});

it("创建失败保留名称并释放重试按钮", async () => {
  const user = userEvent.setup();
  vi.mocked(api.createDirectory).mockRejectedValue(new Error("没有写入权限"));
  render(<DirectoryPicker allowCreate onClose={vi.fn()} onSelect={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: "新建目录" }));
  await user.type(screen.getByRole("textbox", { name: "目录名称" }), "new-parent");

  await user.click(screen.getByRole("button", { name: "创建" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("没有写入权限");
  expect(screen.getByRole("textbox", { name: "目录名称" })).toHaveValue("new-parent");
  expect(screen.getByRole("button", { name: "创建" })).toBeEnabled();
});

it.each([
  {
    system: "Windows",
    path: "C:\\data\\images",
    root: "C:",
    parent: "C:\\data",
    label: "data",
  },
  {
    system: "Windows",
    path: "\\\\host\\share\\data\\images",
    root: "\\\\host\\share",
    parent: "\\\\host\\share\\data",
    label: "data",
  },
  {
    system: "Linux",
    path: "/data\\set/images",
    root: "/",
    parent: "/data\\set",
    label: "data\\set",
  },
])(
  "$system 面包屑保留服务器路径语义：$path",
  async ({ system, path, root, parent, label }) => {
    const user = userEvent.setup();
    vi.mocked(api.listDirectory).mockResolvedValue({
      ...listing,
      system,
      path,
      parent,
    });
    render(<DirectoryPicker initialPath={path} onClose={vi.fn()} onSelect={vi.fn()} />);
    await screen.findByText(`当前后端：test-server · ${system}`);
    const nav = within(screen.getByRole("navigation", { name: "目录路径" }));

    expect(nav.getAllByRole("button")).toHaveLength(3);
    expect(nav.getByRole("button", { name: root })).toBeVisible();
    await user.click(nav.getByRole("button", { name: label }));

    expect(api.listDirectory).toHaveBeenLastCalledWith(parent, false, false, []);
  },
);

it("取数失败时面包屑按目标路径在场，末段点击＝原地重读", async () => {
  const user = userEvent.setup();
  render(<DirectoryPicker initialPath="/srv" onClose={vi.fn()} onSelect={vi.fn()} />);
  await screen.findByRole("button", { name: "package" });
  vi.mocked(api.listDirectory).mockRejectedValueOnce(new Error("目录不存在"));
  await user.click(screen.getByRole("button", { name: "跳转" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("目录不存在");
  const nav = within(screen.getByRole("navigation", { name: "目录路径" }));
  // 面包屑不随取数失败清空（没有它就没有原点重试途径），末段就是重读出口。
  expect(nav.getByRole("button", { name: "srv" })).toBeEnabled();
  await user.click(nav.getByRole("button", { name: "srv" }));

  expect(api.listDirectory).toHaveBeenLastCalledWith("/srv", false, false, []);
  await screen.findByRole("button", { name: "package" });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("空态按后缀场景化附注，不可读项计数加「另有」", async () => {
  vi.mocked(api.listDirectory).mockResolvedValue({
    ...listing,
    entries: [],
    unavailable_count: 2,
  });
  render(
    <DirectoryPicker
      files
      suffixes={[".md", ".txt"]}
      onClose={vi.fn()}
      onSelect={vi.fn()}
    />,
  );

  expect(
    await screen.findByText("没有匹配的项目（仅显示 .md / .txt 文件）"),
  ).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("另有 2 项无法读取");
});

it("初始目录响应不覆盖用户已输入的跳转路径", async () => {
  const user = userEvent.setup();
  let finish: ((value: typeof listing) => void) | undefined;
  vi.mocked(api.listDirectory).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<DirectoryPicker onClose={vi.fn()} onSelect={vi.fn()} />);
  const input = screen.getByRole("textbox", { name: "服务器路径" });

  await user.type(input, "/target");
  await act(async () => {
    finish?.(listing);
  });

  expect(input).toHaveValue("/target");
  expect(screen.getByText("当前后端：test-server · Linux")).toBeVisible();
  vi.mocked(api.listDirectory).mockResolvedValue({ ...listing, path: "/target" });
  await user.click(screen.getByRole("button", { name: "跳转" }));
  expect(api.listDirectory).toHaveBeenLastCalledWith("/target", false, false, []);
  expect(input).toHaveValue("/target");
});

it("筛选变化后丢弃迟到结果，只读形态无采用出口", async () => {
  const user = userEvent.setup();
  let resolveOld: ((value: typeof listing) => void) | undefined;
  vi.mocked(api.listDirectory).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
  );
  const selected = vi.fn();
  render(
    <DirectoryPicker
      initialPath="/srv"
      browseOnly
      onClose={vi.fn()}
      onSelect={selected}
    />,
  );

  await user.click(screen.getByRole("checkbox", { name: "显示隐藏项" }));
  await screen.findByText("SKILL.md");
  await act(async () => {
    resolveOld?.({ ...listing, path: "/wrong", entries: [] });
  });

  expect(api.listDirectory).toHaveBeenLastCalledWith("/srv", true, true, []);
  expect(screen.getByRole("textbox", { name: "服务器路径" })).toHaveValue("/srv");
  // 只读浏览解掉短路后行照样可选（改名／新建入口同铺），但窗里没有「采用」主钮、
  // 页脚也不再有「· 只读」后缀。
  expect(screen.queryByRole("button", { name: /选择此/ })).not.toBeInTheDocument();
  // 页脚「关闭」排在角叉之前（DialogContent 先渲染 children／页脚，角叉随后）——两枚同名，按序取。
  expect(screen.getAllByRole("button", { name: "关闭" })[0]).toBeEnabled();
  expect(screen.getByText("共 2 项")).toBeVisible();
  expect(selected).not.toHaveBeenCalled();
});

it("基础形态打开即有目标（未选中＝当前所在目录），调用方可换主钮文案", async () => {
  const user = userEvent.setup();
  const selected = vi.fn();
  render(
    <DirectoryPicker
      initialPath="/srv"
      primaryLabel="迁移到此目录"
      onClose={vi.fn()}
      onSelect={selected}
    />,
  );
  await screen.findByRole("button", { name: "package" });
  const adopt = screen.getByRole("button", { name: "迁移到此目录" });
  expect(adopt).toBeEnabled();

  await user.click(adopt);

  expect(selected).toHaveBeenCalledExactlyOnceWith("/srv", listing);
});

it("在飞只失效不换装：改名未落定前清单与能力行不响应", async () => {
  const user = userEvent.setup();
  let finishRename: ((value: { task_id: string }) => void) | undefined;
  vi.mocked(api.renameDirectory).mockImplementation(
    () =>
      new Promise((resolve) => {
        finishRename = resolve;
      }),
  );
  render(<DirectoryPicker allowRename onClose={vi.fn()} onSelect={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: "package" }));
  await user.click(screen.getByRole("button", { name: "重命名" }));
  await user.clear(screen.getByRole("textbox", { name: "重命名 package" }));
  await user.type(screen.getByRole("textbox", { name: "重命名 package" }), "renamed");
  await user.keyboard("{Enter}");

  await waitFor(() => expect(api.renameDirectory).toHaveBeenCalledOnce());
  const up = screen.getByRole("button", { name: "上一级" });
  expect(up).toHaveAttribute("aria-disabled", "true");
  await user.click(up);
  expect(api.listDirectory).toHaveBeenCalledTimes(1);

  await act(async () => {
    finishRename?.({ task_id: "rename-task" });
  });
  vi.mocked(api.getTask).mockResolvedValue({
    id: "rename-task",
    status: "succeeded",
    progress: 1,
    error: null,
    result: { path: "/srv/renamed", cleanup_pending: false },
  });
  await waitFor(() => expect(api.getTask).toHaveBeenCalledWith("rename-task"));
});
