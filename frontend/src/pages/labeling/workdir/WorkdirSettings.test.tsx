import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { api } from "../../../api";
import { WorkdirSettings } from "./WorkdirSettings";

vi.mock("../../../api", async (original) => ({
  ...(await original<typeof import("../../../api")>()),
  api: {
    getWorkdir: vi.fn(),
    getWorkdirStats: vi
      .fn()
      .mockResolvedValue({ asset_count: 4, asset_bytes: 2097152 }),
    listBatches: vi.fn(),
    setBatchActive: vi.fn(),
    updateBatch: vi.fn(),
    currentRun: vi.fn().mockResolvedValue({ status: "completed" }),
    relocationStatus: vi.fn().mockResolvedValue([]),
    previewProductCleanup: vi.fn().mockResolvedValue({
      products: [],
      unsupported: [],
      oversize: [],
      total_bytes: 0,
    }),
  },
}));

it("停用运行中的策略先弹确认，失败保留活跃状态并可重试成功", async () => {
  const user = userEvent.setup();
  const changed = vi.fn();
  const batch = {
    id: "s1",
    seq: 1,
    name: "详细描述",
    description: "",
    active: true,
    benchmark: false,
    created_at: "2026-09-17T00:00:00Z",
    product_count: 3,
    run_status: "completed",
  };
  vi.mocked(api.getWorkdir).mockResolvedValue({
    id: "w1",
    path: "/srv/dataset",
    title: "素材",
    last_used_at: 0,
  });
  vi.mocked(api.listBatches).mockResolvedValue([batch]);
  vi.mocked(api.currentRun).mockResolvedValueOnce({
    run_id: "run1",
    batch: 1,
    status: "running",
    mode: "full",
    counters: {},
    current_item: null,
    error: null,
  });
  vi.mocked(api.setBatchActive).mockRejectedValueOnce(new Error("目录暂时被占用"));
  render(<WorkdirSettings wid="w1" onBack={vi.fn()} onChanged={changed} />);

  await user.click(await screen.findByRole("switch", { name: "启用 详细描述" }));
  const dialog = within(screen.getByRole("dialog", { name: "停用策略「详细描述」？" }));
  expect(dialog.getByText(/此策略正在运行。停用会中断本次运行/)).toBeVisible();
  // 停用窗不写「此操作不可撤销」——拨回来即可续跑，备注槽只随删除窗（稿格 10／格 11 分档）。
  expect(dialog.queryByText("此操作不可撤销")).not.toBeInTheDocument();
  expect(api.setBatchActive).not.toHaveBeenCalled();
  await user.click(dialog.getByRole("button", { name: "中断并停用" }));

  expect(await dialog.findByRole("alert")).toHaveTextContent("目录暂时被占用");
  expect(api.setBatchActive).toHaveBeenCalledExactlyOnceWith("w1", "s1", false);
  // 弹窗在场时 Radix 把页面内容标成 aria-hidden，状态点要带 hidden 才查得到。
  expect(screen.getByRole("img", { name: "运行中", hidden: true })).toBeInTheDocument();
  expect(changed).not.toHaveBeenCalled();

  vi.mocked(api.setBatchActive).mockResolvedValue({ ...batch, active: false });
  vi.mocked(api.listBatches).mockResolvedValue([{ ...batch, active: false }]);
  // 钮文字不换词（飞行期只失效），文案恒「中断并停用」。
  await user.click(dialog.getByRole("button", { name: "中断并停用" }));

  expect(await screen.findByRole("img", { name: "已停用" })).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(changed).toHaveBeenCalledOnce();
});

it("运行中的策略出行首蓝点并禁止删除，开关照常可拨", async () => {
  vi.mocked(api.getWorkdir).mockResolvedValue({
    id: "w1",
    path: "/srv/dataset",
    title: "素材",
    last_used_at: 0,
  });
  vi.mocked(api.listBatches).mockResolvedValue([
    {
      id: "s1",
      seq: 1,
      name: "描述",
      description: "",
      active: true,
      benchmark: false,
      created_at: "",
      product_count: 0,
      run_status: "running",
    },
  ]);
  vi.mocked(api.currentRun).mockResolvedValueOnce({
    run_id: "run1",
    batch: 1,
    status: "running",
    mode: "full",
    counters: {},
    current_item: null,
    error: null,
  });
  render(<WorkdirSettings wid="w1" onBack={vi.fn()} onChanged={vi.fn()} />);

  expect(await screen.findByRole("img", { name: "运行中" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "删除策略 s1" })).toBeDisabled();
  expect(screen.getByRole("switch", { name: "启用 描述" })).toBeEnabled();
  // 状态章退役：「活跃」一词不再出现在行内。
  expect(screen.queryByText("活跃")).not.toBeInTheDocument();
});

it("取消就地改名不写盘", async () => {
  const user = userEvent.setup();
  const batch = {
    id: "s1",
    seq: 1,
    name: "详细描述",
    description: "",
    active: true,
    benchmark: false,
    created_at: "",
    product_count: 0,
    run_status: null,
  };
  vi.mocked(api.getWorkdir).mockResolvedValue({
    id: "w1",
    path: "/srv/dataset",
    title: "素材",
    last_used_at: 0,
  });
  vi.mocked(api.listBatches).mockResolvedValue([batch]);
  render(<WorkdirSettings wid="w1" onBack={vi.fn()} onChanged={vi.fn()} />);

  await user.click(await screen.findByRole("button", { name: "改名策略 详细描述" }));
  const input = screen.getByRole("textbox", { name: "策略名称 s1" });
  await user.clear(input);
  await user.type(input, "未提交{Escape}");

  expect(
    await screen.findByRole("button", { name: "改名策略 详细描述" }),
  ).toBeVisible();
  expect(api.updateBatch).not.toHaveBeenCalled();
});

it("统计读取失败给固定因果句、不铺后端原句，也不展示零值代替失败", async () => {
  vi.mocked(api.getWorkdir).mockResolvedValue({
    id: "w1",
    path: "/srv/dataset",
    title: "素材",
    last_used_at: 0,
  });
  vi.mocked(api.listBatches).mockResolvedValue([]);
  vi.mocked(api.getWorkdirStats).mockRejectedValueOnce(new Error("统计读取失败"));

  render(<WorkdirSettings wid="w1" onBack={vi.fn()} onChanged={vi.fn()} />);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "素材统计失败，目录在读取时被占用",
  );
  expect(screen.queryByText("统计读取失败")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "导入素材" })).toBeEnabled();
  expect(screen.getByRole("region", { name: "基本信息" })).not.toHaveTextContent(
    "素材 0",
  );
});

it("清理摘要未回时值位缺席但入口可用，回包后补上读数", async () => {
  let resolveCleanup:
    | ((value: Awaited<ReturnType<typeof api.previewProductCleanup>>) => void)
    | undefined;
  vi.mocked(api.getWorkdir).mockResolvedValue({
    id: "w1",
    path: "/srv/dataset",
    title: "素材",
    last_used_at: 0,
  });
  vi.mocked(api.listBatches).mockResolvedValue([]);
  vi.mocked(api.previewProductCleanup).mockReturnValue(
    new Promise((resolve) => {
      resolveCleanup = resolve;
    }),
  );
  render(<WorkdirSettings wid="w1" onBack={vi.fn()} onChanged={vi.fn()} />);

  const card = await screen.findByRole("region", { name: "基本信息" });
  expect(within(card).getByRole("button", { name: "查看无效文件清单" })).toBeEnabled();
  expect(card).not.toHaveTextContent("无效文件：");

  await act(async () => {
    resolveCleanup?.({
      products: [{ name: "s1__a.txt", size: 1024, batch: 1, reason: "无配对产物" }],
      unsupported: [],
      oversize: [],
      total_bytes: 1024,
    });
  });

  expect(screen.getByRole("region", { name: "基本信息" })).toHaveTextContent(
    "无效文件：1 个（无配对产物 1 ／ 不支持 0 ／ 超限 0；含 1 套策略、内 0 套已停用）· 1.0 KB",
  );
});

it("点击策略名就地编辑，失败保留输入，回车重试成功后更新目录", async () => {
  const user = userEvent.setup();
  const changed = vi.fn();
  const batch = {
    id: "s1",
    seq: 1,
    name: "详细描述",
    description: "",
    active: true,
    benchmark: false,
    created_at: "",
    product_count: 2,
    run_status: null,
  };
  vi.mocked(api.getWorkdir).mockResolvedValue({
    id: "w1",
    path: "/srv/dataset",
    title: "素材",
    last_used_at: 0,
  });
  vi.mocked(api.listBatches).mockResolvedValue([batch]);
  vi.mocked(api.updateBatch).mockRejectedValueOnce(new Error("保存失败"));
  render(<WorkdirSettings wid="w1" onBack={vi.fn()} onChanged={changed} />);

  await user.click(await screen.findByRole("button", { name: "改名策略 详细描述" }));
  const input = screen.getByRole("textbox", { name: "策略名称 s1" });
  await user.clear(input);
  await user.type(input, "新描述{Enter}");

  // 失败红字落在编辑行内（产物计数右侧），不再另起行下块。
  expect(await screen.findByRole("alert")).toHaveTextContent("保存失败");
  expect(input).toHaveValue("新描述");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(changed).not.toHaveBeenCalled();
  vi.mocked(api.updateBatch).mockResolvedValue({ ...batch, name: "新描述" });
  vi.mocked(api.listBatches).mockResolvedValue([{ ...batch, name: "新描述" }]);
  await user.type(input, "{Enter}");

  expect(await screen.findByRole("button", { name: "改名策略 新描述" })).toBeVisible();
  expect(api.updateBatch).toHaveBeenLastCalledWith("w1", "s1", { name: "新描述" });
  expect(changed).toHaveBeenCalledOnce();
});

it("清理摘要按策略去重统计并并进基本信息卡第四行", async () => {
  vi.mocked(api.getWorkdir).mockResolvedValue({
    id: "w1",
    path: "/srv/dataset",
    title: "素材",
    last_used_at: 0,
  });
  vi.mocked(api.listBatches).mockResolvedValue([
    {
      id: "s1",
      seq: 1,
      name: "详细描述",
      description: "",
      active: true,
      benchmark: false,
      created_at: "2026-09-17T00:00:00Z",
      product_count: 2,
      run_status: "completed",
    },
    {
      id: "s2",
      seq: 2,
      name: "简短描述",
      description: "",
      active: false,
      benchmark: false,
      created_at: "2026-09-17T00:00:00Z",
      product_count: 1,
      run_status: null,
    },
  ]);
  vi.mocked(api.previewProductCleanup).mockResolvedValue({
    products: [
      { name: "s1__first.txt", size: 1024, batch: 1, reason: "无配对产物" },
      { name: "s1__second.txt", size: 1024, batch: 1, reason: "无配对产物" },
      { name: "s2__third.txt", size: 1024, batch: 2, reason: "无配对产物" },
    ],
    unsupported: [
      { name: "design.psd", size: 2048, batch: null, reason: "扩展名不支持" },
    ],
    oversize: [],
    total_bytes: 5120,
  });

  render(<WorkdirSettings wid="w1" onBack={vi.fn()} onChanged={vi.fn()} />);

  const card = await screen.findByRole("region", { name: "基本信息" });
  // 值句里数字挂了 tabular-nums 子节点，按文本查询会被拆段——整卡 textContent 才是稳的判法。
  expect(card).toHaveTextContent(
    "无效文件：4 个（无配对产物 3 ／ 不支持 1 ／ 超限 0；含 2 套策略、内 1 套已停用）· 5.0 KB",
  );
  expect(card).toHaveTextContent("素材 4 · 产物 3 · 2.00 MB");
  expect(screen.getByRole("button", { name: "查看无效文件清单" })).toBeVisible();
  expect(screen.getByText("产物 2 / 4")).toBeVisible();
  // 「清理运行记录」独立入口已撤（ADR 2026-09-21/10-09 线）：出口改由出错那一行就地给。
  expect(screen.queryByText("清理运行记录")).not.toBeInTheDocument();
  // 清理区不再是独立区块（卡退役④），删除也不再有「危险操作」卡（16z1 条②）。
  expect(screen.queryByRole("region", { name: "清理" })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "危险操作" })).not.toBeInTheDocument();
});

it("区块只剩基本信息与目录策略两卡，删除钮落在头行题字右侧", async () => {
  vi.mocked(api.getWorkdir).mockResolvedValue({
    id: "w1",
    path: "/srv/dataset",
    title: "素材",
    last_used_at: 0,
  });
  vi.mocked(api.listBatches).mockResolvedValue([]);

  render(<WorkdirSettings wid="w1" onBack={vi.fn()} onChanged={vi.fn()} />);

  await screen.findByRole("region", { name: "基本信息" });
  const regions = within(screen.getByRole("region", { name: "工作目录设置" }))
    .getAllByRole("region")
    .map((region) => region.getAttribute("aria-label"));
  expect(regions).toEqual(["基本信息", "目录策略"]);
  expect(screen.getByRole("button", { name: "删除工作目录" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "返回主页面" })).toBeEnabled();
});
