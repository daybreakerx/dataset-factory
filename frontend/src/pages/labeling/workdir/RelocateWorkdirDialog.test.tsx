import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ApiError, api, type TaskView } from "../../../api";
import type { components } from "../../../api-types.gen";
import { RelocateWorkdirDialog } from "./RelocateWorkdirDialog";

vi.mock("../../../api", async (original) => ({
  ...(await original<typeof import("../../../api")>()),
  api: {
    relocateWorkdir: vi.fn(),
    getTask: vi.fn(),
    cancelTask: vi.fn(),
    listDirectory: vi.fn(),
    relocationEvidence: vi.fn(),
    abandonCopy: vi.fn(),
    abandonSwitchover: vi.fn(),
    retryRelocationCleanup: vi.fn(),
  },
}));

type RelocationRecord = components["schemas"]["WorkdirRelocationStatus"];

const completed: TaskView = {
  id: "move-1",
  status: "succeeded",
  progress: 1,
  error: null,
  result: { path: "/srv/new", old_path: "/srv/old", cleanup_pending: false },
};

const dirEntry: components["schemas"]["DirectoryEntry"] = {
  name: "package",
  path: "/srv/package",
  kind: "directory",
  media: "file",
  is_empty: true,
  modified_at: "2026-09-17T00:00:00Z",
  size: null,
};

const listing: components["schemas"]["DirectoryListing"] = {
  hostname: "test-server",
  system: "Linux",
  path: "/srv",
  parent: "/",
  is_empty: false,
  unavailable_count: 0,
  entries: [dirEntry],
};

const copyRetained: RelocationRecord = {
  old_path: "/srv/old",
  path: "/srv/new",
  status: "copy-retained",
};

const cleanupPending: RelocationRecord = {
  old_path: "/srv/old",
  path: "/srv/new",
  status: "cleanup-pending",
};

const cleanEvidence: components["schemas"]["WorkdirRelocationEvidence"] = {
  old_present: true,
  old_changed: false,
  old_replaced: false,
  target_in_use: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.listDirectory).mockResolvedValue(listing);
  vi.mocked(api.relocateWorkdir).mockResolvedValue({ task_id: "move-1" });
  vi.mocked(api.getTask).mockResolvedValue(completed);
  vi.mocked(api.relocationEvidence).mockResolvedValue(cleanEvidence);
  vi.mocked(api.abandonCopy).mockResolvedValue({ path: "/srv/old" });
  vi.mocked(api.abandonSwitchover).mockResolvedValue({ path: "/srv/old" });
  vi.mocked(api.retryRelocationCleanup).mockResolvedValue({
    old_path: "/srv/old",
    cleanup_pending: false,
  });
});

/** 挂上浏览态弹窗（无未结清记录＝打开即选目标，稿格 2）。 */
function renderBrowse(
  overrides: { source?: string; onChanged?: () => void; onClose?: () => void } = {},
) {
  render(
    <RelocateWorkdirDialog
      wid="w1"
      source={overrides.source ?? "/srv/old"}
      records={[]}
      onClose={overrides.onClose ?? vi.fn()}
      onChanged={overrides.onChanged ?? vi.fn()}
      onRunningChange={vi.fn()}
    />,
  );
}

/** 挂上「有未完结迁移」的处置态弹窗（宿主路径行链接是唯一入口，稿格 8~16）。 */
function renderPending(
  records: RelocationRecord[],
  overrides: { source?: string; onClose?: () => void; onChanged?: () => void } = {},
) {
  render(
    <RelocateWorkdirDialog
      wid="w1"
      source={overrides.source ?? "/srv/new"}
      records={records}
      onClose={overrides.onClose ?? vi.fn()}
      onChanged={overrides.onChanged ?? vi.fn()}
      onRunningChange={vi.fn()}
    />,
  );
}

/** 浏览态发起这一次迁移：选中空目录 → 点「迁移到此目录」。 */
async function launch(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole("button", { name: "package" }, { timeout: 5_000 }),
  );
  await user.click(screen.getByRole("button", { name: "迁移到此目录" }));
}

it("浏览态按「要求目标为空」把关：非空不亮、选中空目录才受理", async () => {
  const user = userEvent.setup();
  renderBrowse();
  const primary = await screen.findByRole(
    "button",
    { name: "迁移到此目录" },
    { timeout: 5_000 },
  );

  expect(primary).toBeDisabled();
  expect(primary).toHaveAttribute(
    "title",
    "迁移目标目录必须为空——请选中一个空文件夹，或进入一个空文件夹。",
  );

  await user.click(screen.getByRole("button", { name: "package" }));

  expect(primary).toBeEnabled();
  await user.click(primary);

  expect(api.relocateWorkdir).toHaveBeenCalledExactlyOnceWith("w1", "/srv/package");
});

it("选中非空目录时禁用原因点名选中项", async () => {
  const user = userEvent.setup();
  vi.mocked(api.listDirectory).mockResolvedValue({
    ...listing,
    entries: [{ ...dirEntry, is_empty: false }],
  });
  renderBrowse();

  await user.click(
    await screen.findByRole("button", { name: "package" }, { timeout: 5_000 }),
  );

  const primary = screen.getByRole("button", { name: "迁移到此目录" });
  expect(primary).toBeDisabled();
  expect(primary).toHaveAttribute(
    "title",
    "迁移目标目录必须为空——选中的「package」不是空目录。",
  );
});

it("受理被拒只给一行红字、主钮照常可点，改完条件原地再点", async () => {
  const user = userEvent.setup();
  const changed = vi.fn();
  vi.mocked(api.relocateWorkdir).mockRejectedValueOnce(
    new Error("该工作目录正在跑批，请等它结束或停止后再试。"),
  );
  renderBrowse({ onChanged: changed });

  await launch(user);

  expect(await screen.findByRole("alert")).toHaveTextContent("该工作目录正在跑批");
  expect(changed).not.toHaveBeenCalled();
  const primary = screen.getByRole("button", { name: "迁移到此目录" });
  expect(primary).toBeEnabled();

  await user.click(primary);

  expect(api.relocateWorkdir).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("迁移一条龙成功：完成给结果句、选择动作退场", async () => {
  const user = userEvent.setup();
  renderBrowse();

  await launch(user);

  expect(
    await screen.findByText("已迁移到 /srv/new，原目录已删除。", undefined, {
      timeout: 5_000,
    }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "迁移到此目录" }),
  ).not.toBeInTheDocument();
});

it("成功但旧目录没删净时转③类处置界面", async () => {
  const user = userEvent.setup();
  vi.mocked(api.getTask).mockResolvedValue({
    ...completed,
    result: { path: "/srv/new", old_path: "/srv/old", cleanup_pending: true },
  });
  renderBrowse();

  await launch(user);

  expect(
    await screen.findByText(
      "已迁移到 /srv/new；旧目录 /srv/old 尚未删除。",
      undefined,
      {
        timeout: 5_000,
      },
    ),
  ).toBeVisible();
  expect(api.relocationEvidence).toHaveBeenCalledExactlyOnceWith("w1", "/srv/old");
  // 取证未回时「删除旧目录」不亮（判据没到手不给动作）——等它落地。
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "删除旧目录" })).toBeEnabled(),
  );
});

it("②类处置给继续迁移：按记录里的目标续跑一条龙", async () => {
  const user = userEvent.setup();
  renderPending([copyRetained], { source: "/srv/old" });

  expect(
    await screen.findByText(
      "上次迁移未完成：已复制到 /srv/new，但还没有切换过去。",
      undefined,
      {
        timeout: 5_000,
      },
    ),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "继续迁移" }));

  expect(api.relocateWorkdir).toHaveBeenCalledExactlyOnceWith("w1", "/srv/new");
  expect(
    await screen.findByText("已迁移到 /srv/new，原目录已删除。", undefined, {
      timeout: 5_000,
    }),
  ).toBeVisible();
});

it("②类放弃迁移走同弹窗二次确认，确认后才删副本并关窗", async () => {
  const user = userEvent.setup();
  const close = vi.fn();
  const changed = vi.fn();
  renderPending([copyRetained], {
    source: "/srv/old",
    onClose: close,
    onChanged: changed,
  });

  await user.click(
    await screen.findByRole("button", { name: "放弃迁移" }, { timeout: 5_000 }),
  );

  expect(within(screen.getByRole("dialog")).getByText("放弃迁移？")).toBeVisible();
  expect(
    screen.getByText(
      "将删除未完成副本 /srv/new，并保留现位置 /srv/old 不变。副本删除后不可恢复。",
    ),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "取消" }));
  expect(api.abandonCopy).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "放弃迁移" }));
  await user.click(screen.getByRole("button", { name: "确认放弃" }));

  expect(api.abandonCopy).toHaveBeenCalledExactlyOnceWith("w1", "/srv/new");
  expect(close).toHaveBeenCalledOnce();
  expect(changed).toHaveBeenCalledOnce();
});

it("③类新目录已开始运行时只给删旧，不给放弃（撤销会丢改动）", async () => {
  vi.mocked(api.relocationEvidence).mockResolvedValue({
    ...cleanEvidence,
    target_in_use: true,
  });
  renderPending([cleanupPending]);

  expect(
    await screen.findByText("新目录已开始运行，不可删除。", undefined, {
      timeout: 5_000,
    }),
  ).toBeVisible();
  expect(api.relocationEvidence).toHaveBeenCalledExactlyOnceWith("w1", "/srv/old");
  expect(screen.queryByRole("button", { name: "放弃迁移" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "删除旧目录" })).toBeEnabled();
});

it("③类旧目录被动过才走二次确认，确认后带 confirm_changed 删旧", async () => {
  const user = userEvent.setup();
  vi.mocked(api.relocationEvidence).mockResolvedValue({
    ...cleanEvidence,
    old_changed: true,
  });
  renderPending([cleanupPending]);
  await screen.findByRole("button", { name: "删除旧目录" }, { timeout: 5_000 });

  await user.click(screen.getByRole("button", { name: "删除旧目录" }));

  expect(api.retryRelocationCleanup).not.toHaveBeenCalled();
  expect(
    screen.getByText("旧目录 /srv/old 里有迁移后变更或新增的内容，删除后不可恢复。"),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "删除旧目录" }));

  expect(api.retryRelocationCleanup).toHaveBeenCalledExactlyOnceWith(
    "w1",
    "/srv/old",
    true,
  );
  expect(
    await screen.findByText("已迁移到 /srv/new，原目录已删除。", undefined, {
      timeout: 5_000,
    }),
  ).toBeVisible();
});

it("③类旧路径已非同一目录时确认句点名身份", async () => {
  const user = userEvent.setup();
  vi.mocked(api.relocationEvidence).mockResolvedValue({
    ...cleanEvidence,
    old_replaced: true,
  });
  renderPending([cleanupPending]);

  await user.click(
    await screen.findByRole("button", { name: "删除旧目录" }, { timeout: 5_000 }),
  );

  expect(
    screen.getByText("旧目录 /srv/old 此路径已不是当初那个旧目录，删除后不可恢复。"),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "删除旧目录" }));

  expect(api.retryRelocationCleanup).toHaveBeenCalledExactlyOnceWith(
    "w1",
    "/srv/old",
    true,
  );
});

it("③类旧目录没被动过时直接删、不打扰", async () => {
  const user = userEvent.setup();
  renderPending([cleanupPending]);

  await user.click(
    await screen.findByRole("button", { name: "删除旧目录" }, { timeout: 5_000 }),
  );

  expect(screen.queryByText("删除旧目录？")).not.toBeInTheDocument();
  expect(api.retryRelocationCleanup).toHaveBeenCalledExactlyOnceWith(
    "w1",
    "/srv/old",
    false,
  );
  expect(
    await screen.findByText("已迁移到 /srv/new，原目录已删除。", undefined, {
      timeout: 5_000,
    }),
  ).toBeVisible();
});

it("③类放弃迁移退回原位置，被占用时红字不关窗", async () => {
  const user = userEvent.setup();
  const close = vi.fn();
  vi.mocked(api.abandonSwitchover).mockRejectedValueOnce(
    new Error("新目录已投入使用，不能放弃这次迁移。"),
  );
  renderPending([cleanupPending], { onClose: close });
  await user.click(
    await screen.findByRole("button", { name: "放弃迁移" }, { timeout: 5_000 }),
  );

  expect(
    screen.getByText(
      "将会删除新目录 /srv/new，并退回原位置 /srv/old。删除后不可恢复。",
    ),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "确认放弃" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("已投入使用");
  expect(close).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "放弃迁移" }));
  await user.click(screen.getByRole("button", { name: "确认放弃" }));

  expect(api.abandonSwitchover).toHaveBeenCalledTimes(2);
  expect(api.abandonSwitchover).toHaveBeenLastCalledWith("w1", "/srv/old");
  expect(close).toHaveBeenCalledOnce();
});

it("迁移在飞可关窗退出（退出 ≠ 撤销），取消失败允许重试", async () => {
  const user = userEvent.setup();
  const close = vi.fn();
  const running: TaskView = {
    id: "move-1",
    status: "running",
    progress: 0.37,
    error: null,
    result: null,
  };
  vi.mocked(api.getTask).mockResolvedValue(running);
  renderBrowse({ onClose: close });
  await launch(user);

  expect(
    await screen.findByText("迁移到 /srv/package", undefined, { timeout: 5_000 }),
  ).toBeVisible();
  expect(screen.getByText("正在复制并校验 · 37%")).toBeVisible();
  expect(screen.getByRole("button", { name: "取消" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );

  await user.click(screen.getByRole("button", { name: "关闭" }));

  expect(close).toHaveBeenCalledOnce();
});

it("取消失败允许重试，取消请求受理后等真实终态", async () => {
  const user = userEvent.setup();
  const running: TaskView = {
    id: "move-1",
    status: "running",
    progress: 0.37,
    error: null,
    result: null,
  };
  vi.mocked(api.getTask).mockResolvedValue(running);
  vi.mocked(api.cancelTask)
    .mockRejectedValueOnce(new Error("取消请求中断"))
    .mockResolvedValue(running);
  renderBrowse();

  await launch(user);
  await user.click(
    await screen.findByRole("button", { name: "取消迁移" }, { timeout: 5_000 }),
  );

  expect(await screen.findByRole("alert")).toHaveTextContent("取消请求中断");
  expect(screen.getByRole("button", { name: "取消迁移" })).toBeEnabled();

  await user.click(screen.getByRole("button", { name: "取消迁移" }));

  expect(api.cancelTask).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("button", { name: "正在取消" })).toBeDisabled();
});

it("取消后落②类待处置：界面给继续迁移与放弃迁移", async () => {
  const user = userEvent.setup();
  const running: TaskView = {
    id: "move-1",
    status: "running",
    progress: 0.37,
    error: null,
    result: null,
  };
  vi.mocked(api.getTask)
    .mockResolvedValueOnce(running)
    .mockResolvedValue({ ...running, status: "cancelled", error: "迁移已取消" });
  vi.mocked(api.cancelTask).mockResolvedValue(running);
  renderBrowse();

  await launch(user);
  await user.click(
    await screen.findByRole("button", { name: "取消迁移" }, { timeout: 5_000 }),
  );

  expect(
    await screen.findByText(
      "上次迁移未完成：已复制到 /srv/package，但还没有切换过去。",
      {},
      { timeout: 5_000 },
    ),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "继续迁移" })).toBeEnabled();
});

it("续跑在飞不给取消入口，两钮只失效（稿格 10）", async () => {
  const user = userEvent.setup();
  const running: TaskView = {
    id: "move-1",
    status: "running",
    progress: 0.92,
    error: null,
    result: null,
  };
  vi.mocked(api.getTask).mockResolvedValue(running);
  renderPending([copyRetained], { source: "/srv/old" });

  await user.click(
    await screen.findByRole("button", { name: "继续迁移" }, { timeout: 5_000 }),
  );

  expect(
    await screen.findByText("继续迁移到 /srv/new", undefined, { timeout: 5_000 }),
  ).toBeVisible();
  expect(screen.getByText("正在校验并切换 · 92%")).toBeVisible();
  expect(screen.queryByRole("button", { name: "取消迁移" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "继续迁移" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
});

it("任务丢失报一句并交回宿主重取，界面不自动重跑", async () => {
  const user = userEvent.setup();
  const changed = vi.fn();
  vi.mocked(api.getTask).mockRejectedValue(
    new ApiError("http", "任务不存在", 404, null),
  );
  renderBrowse({ onChanged: changed });

  await launch(user);

  expect(await screen.findByRole("alert")).toHaveTextContent("上次任务已丢失");
  expect(changed).toHaveBeenCalledOnce();
  expect(api.relocateWorkdir).toHaveBeenCalledOnce();
});

it("迁移在飞时宿主重取记录不打回浏览态", async () => {
  const user = userEvent.setup();
  const running: TaskView = {
    id: "move-1",
    status: "running",
    progress: 0.2,
    error: null,
    result: null,
  };
  vi.mocked(api.getTask).mockResolvedValue(running);
  const view = render(
    <RelocateWorkdirDialog
      wid="w1"
      source="/srv/old"
      records={[]}
      onClose={vi.fn()}
      onChanged={vi.fn()}
      onRunningChange={vi.fn()}
    />,
  );
  await launch(user);
  await screen.findByText("正在复制并校验 · 20%", undefined, { timeout: 5_000 });

  view.rerender(
    <RelocateWorkdirDialog
      wid="w1"
      source="/srv/old"
      records={[copyRetained]}
      onClose={vi.fn()}
      onChanged={vi.fn()}
      onRunningChange={vi.fn()}
    />,
  );

  expect(screen.getByText("正在复制并校验 · 20%")).toBeVisible();
});
