import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import type { components } from "../../api-types.gen";
import { LabelingPage } from "./LabelingPage";

vi.mock("../../api", () => ({
  api: {
    listWorkdirs: vi.fn(),
    listBatches: vi.fn(),
    listItems: vi.fn(),
    readCaption: vi.fn().mockResolvedValue("caption"),
    testEndpoint: vi
      .fn()
      .mockResolvedValue({ ok: true, message: "连通", latency_ms: 1 }),
    addRetryItems: vi.fn(),
    removeRetryItem: vi.fn(),
    clearRetryItems: vi.fn(),
    importMaterials: vi.fn(),
    listDirectory: vi.fn(),
    removeUnimported: vi.fn(),
    getTask: vi.fn(),
    cancelTask: vi.fn(),
    getBatchSnapshot: vi.fn(),
    startRun: vi.fn().mockResolvedValue({ run_id: "run" }),
    currentRun: vi.fn().mockResolvedValue({ status: "completed" }),
    latestRun: vi.fn(),
    exportPlan: vi.fn().mockResolvedValue({
      batch: 1,
      included: [],
      excluded: [],
      total_bytes: 0,
      sequential: true,
      non_ascii_names: false,
    }),
  },
  ApiError: class extends Error {},
  errorMessage: (error: unknown) => String(error),
}));

function view(name: string): components["schemas"]["ItemListView"] {
  return {
    batch: 1,
    query: "",
    groups: {
      done: [
        {
          item: name,
          name: `${name}.jpg`,
          status: "done",
          media: "image",
          in_retry: false,
          can_retry: true,
        },
      ],
    },
  };
}

/** ⑫ 同一条目在两组各占一行：原分组那行带「重打」章、可及名不止文件名，故按分组区取行。 */
function retriedRowPair() {
  const original = within(screen.getByRole("region", { name: "已完成" })).getByRole(
    "button",
    { name: /first\.jpg/ },
  );
  const retry = within(screen.getByRole("region", { name: "重试列表" })).getByRole(
    "button",
    { name: "first.jpg" },
  );
  return { original, retry };
}

/** 「已完成」组里的一条素材，同时已排进重试名单（两组各占一行）。 */
function retryView(): components["schemas"]["ItemListView"] {
  const initial = view("first");
  const row = initial.groups.done?.[0];
  if (!row) throw new Error("缺少测试素材");
  row.in_retry = true;
  initial.groups.retry = [row];
  return initial;
}

beforeEach(() => {
  vi.clearAllMocks();
  // 切页记忆走 localStorage：清档防止用例间串状态。
  localStorage.clear();
  vi.mocked(api.currentRun).mockResolvedValue({
    run_id: "old",
    status: "completed",
    batch: 1,
    mode: "full",
    counters: {},
    current_item: null,
    error: null,
  });
  vi.mocked(api.listWorkdirs).mockResolvedValue([
    { id: "one", title: "目录一", path: "/one", last_used_at: 0 },
    { id: "two", title: "目录二", path: "/two", last_used_at: 0 },
  ]);
  vi.mocked(api.listBatches).mockResolvedValue([
    {
      id: "s1",
      seq: 1,
      name: "策略",
      active: true,
      created_at: "",
      description: "",
      product_count: 1,
    },
  ]);
  vi.mocked(api.listItems).mockResolvedValue(view("first"));
  vi.mocked(api.latestRun).mockResolvedValue({
    record: null,
    log_path: null,
    items_path: null,
  });
  vi.mocked(api.getBatchSnapshot).mockResolvedValue({
    built_at: "2026-09-18T00:00:00Z",
    changed: false,
    endpoint: {
      api_format: "openai-chat",
      base_url: "https://example.test/v1",
      model: "mock-model",
      name: "Mock endpoint",
      request_params: {},
      sha256: "endpoint",
    },
    prompt: { body: "prompt", name: "Mock prompt", sha256: "prompt" },
    recorded_sha256: "snapshot",
    sha256: "snapshot",
    skills: [
      {
        name: "Mock skill",
        files: [{ path: "SKILL.md", body: "skill", sha256: "skill" }],
      },
    ],
    tool_version: "0.1.0",
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("打标页读取流程", () => {
  it("一处目录读取失败不会阻止其他目录使用，错误目录仍可定位", async () => {
    vi.mocked(api.listBatches).mockImplementation(async (wid) => {
      if (wid === "one") throw new Error("目录不存在");
      return [
        {
          id: "s1",
          seq: 1,
          name: "策略",
          active: true,
          created_at: "",
          description: "",
          product_count: 1,
        },
      ];
    });
    const user = userEvent.setup();
    await act(async () => {
      render(<LabelingPage />);
    });

    expect(
      await screen.findByRole("button", { name: "first.jpg" }),
    ).toBeInTheDocument();
    expect(api.listItems).toHaveBeenCalledWith("two", "s1");
    await user.click(screen.getByRole("button", { name: "选择工作目录与批次" }));
    const unavailable = within(screen.getByRole("group", { name: "目录一" }));
    // 打开即重拉（族加载态）：飞行期行位会短暂换成「正在读取…」，行回来再断言。
    expect(await unavailable.findByText(/目录不存在/)).toBeInTheDocument();
    expect(
      unavailable.getByRole("button", { name: "工作目录设置 目录一" }),
    ).toBeEnabled();
    expect(unavailable.getByRole("button", { name: "新增策略 目录一" })).toBeDisabled();
  });

  it("提示词与技能同名时仍分别展示且没有重复 key", async () => {
    const snapshot = await api.getBatchSnapshot("one", "s1");
    snapshot.prompt.name = "shared";
    snapshot.skills = [
      {
        name: "shared",
        files: [{ path: "SKILL.md", body: "skill", sha256: "skill" }],
      },
    ];
    vi.mocked(api.getBatchSnapshot).mockResolvedValue(snapshot);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(<LabelingPage />);
      // 等待对象＝打标页分包载入的真实异步边界：高负载下 1s 默认窗不够（同 App.test 注）。
      const context = await screen.findByRole(
        "region",
        { name: "策略配置" },
        { timeout: 5_000 },
      );

      expect(within(context).getAllByText("shared")).toHaveLength(2);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });

  it("顶栏展示批次快照的只读端点、提示词与技能上下文", async () => {
    render(<LabelingPage />);
    const context = await screen.findByRole(
      "region",
      { name: "策略配置" },
      { timeout: 5_000 },
    );
    expect(context).toHaveTextContent("Example · mock-model");
    expect(context).toHaveTextContent("Mock prompt");
    expect(context).toHaveTextContent("Mock skill");
  });

  it("自动预览当前运行素材，手动查看与返回概览不会被运行刷新抢走", async () => {
    let source: EventTarget | undefined;
    vi.stubGlobal(
      "EventSource",
      class extends EventTarget {
        constructor() {
          super();
          source = this;
        }
        close(): void {}
      },
    );
    vi.mocked(api.currentRun).mockResolvedValue({
      run_id: "run",
      status: "running",
      batch: 1,
      mode: "full",
      counters: { planned: 2, attempted: 0 },
      current_item: "first",
      error: null,
    });
    const initial = view("first");
    initial.groups.done = [
      ...(initial.groups.done ?? []),
      ...(view("second").groups.done ?? []),
    ];
    vi.mocked(api.listItems).mockResolvedValue(initial);
    const user = userEvent.setup();
    render(<LabelingPage />);

    expect(
      await screen.findByRole("heading", { name: "first.jpg" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "second.jpg" }));
    await act(async () => source?.dispatchEvent(new Event("run-started")));
    expect(screen.getByRole("heading", { name: "second.jpg" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "返回概览" }));
    await act(async () => source?.dispatchEvent(new Event("run-started")));
    expect(
      screen.queryByRole("heading", { name: "first.jpg" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "second.jpg" }),
    ).not.toBeInTheDocument();
  });

  it("立即中断后半截留在原地并挂「已中断」琥珀标签（E5 稿矩阵⑨）", async () => {
    // jsdom 的 dispatchEvent 不联动 onopen handler 属性（实测），mock 类自带 fireOpen。
    let source: (EventTarget & { fireOpen: () => void }) | undefined;
    vi.stubGlobal(
      "EventSource",
      class extends EventTarget {
        onopen: ((event: Event) => void | Promise<void>) | null = null;
        constructor() {
          super();
          source = this;
        }
        close(): void {}
        fireOpen(): void {
          void this.onopen?.(new Event("open"));
        }
      },
    );
    vi.mocked(api.currentRun).mockResolvedValue({
      run_id: "run",
      status: "running",
      batch: 1,
      mode: "full",
      counters: { planned: 2, attempted: 0 },
      current_item: "first",
      error: null,
    });
    vi.mocked(api.listItems).mockResolvedValue(view("first"));
    render(<LabelingPage />);

    // 跟随在飞条目 → 条目预览挂载；开层就绪后 started＋一段正文增量下半截在场。
    await screen.findByRole("heading", { name: "first.jpg" });
    await act(async () => {
      source?.fireOpen();
      // onopen 链是 async（syncProgress＋onFinish 各一拍），补拍确保 ready 落定后再发事件。
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      source?.dispatchEvent(
        new MessageEvent("item-updated", {
          data: JSON.stringify({
            item: "first",
            batch: 1,
            status: "started",
            attempt: 0,
            can_retry: false,
            reason_code: null,
            message: null,
          }),
        }),
      );
    });
    await act(async () => {
      source?.dispatchEvent(
        new MessageEvent("item-delta", {
          data: JSON.stringify({
            item: "first",
            batch: 1,
            delta: "content",
            text: "一位年轻女性站在米白色纱帘前",
          }),
        }),
      );
    });
    expect(await screen.findByText(/纱帘前/)).toBeInTheDocument();

    // run-finished(interrupted)＝手动停止：半截不清空、标签出场（琥珀）。
    await act(async () => {
      source?.dispatchEvent(
        new MessageEvent("run-finished", {
          data: JSON.stringify({
            run_id: "run",
            batch: 1,
            status: "interrupted",
            counters: { planned: 2, attempted: 1 },
          }),
        }),
      );
    });

    expect(screen.getByText(/纱帘前/)).toBeInTheDocument();
    expect(screen.getByText("已中断")).toBeInTheDocument();
  });

  it("开始重试发车后：在飞的失败行视图层转「排队中」、撤出原分组且不带原因（T14 条目行⑨）", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "EventSource",
      class extends EventTarget {
        close(): void {}
      },
    );
    vi.mocked(api.currentRun).mockResolvedValue({
      run_id: "run",
      status: "running",
      batch: 1,
      mode: "retry",
      counters: { planned: 1, attempted: 0 },
      current_item: null,
      error: null,
    });
    const failed = view("first");
    failed.groups.done = [];
    failed.groups.failed = [
      {
        item: "first",
        name: "first.jpg",
        status: "failed",
        media: "image",
        in_retry: true,
        can_retry: true,
        reason_code: "timeout",
        message: "端点超时",
      },
    ];
    failed.groups.retry = [...failed.groups.failed];
    vi.mocked(api.listItems).mockResolvedValue(failed);
    render(<LabelingPage />);

    // 初始：失败行在「未完成」组、原因行在场（行同时在重试清单里，按组取）。
    await screen.findByRole("region", { name: "未完成" });
    expect(
      within(screen.getByRole("region", { name: "未完成" })).getByText("端点超时"),
    ).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /开始重试/ }));

    // 发车受理后（run 在飞）：视图层转「排队中」——原分组撤出、失败原因不带。
    await waitFor(() =>
      expect(
        within(screen.getByRole("region", { name: "排队中" })).getByText("first.jpg"),
      ).toBeInTheDocument(),
    );
    expect(
      within(screen.getByRole("region", { name: "未完成" })).queryByText("first.jpg"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("端点超时")).not.toBeInTheDocument();
  });

  it("未导入删除先确认，成功刷新清单且保留同主干在册素材", async () => {
    const initial = view("first");
    initial.groups.unimported = [
      {
        item: "first",
        name: "first.psd",
        status: "unimported",
        media: "file",
        can_retry: false,
        in_retry: false,
        reason: "扩展名不支持",
      },
    ];
    vi.mocked(api.listItems).mockResolvedValue(initial);
    vi.mocked(api.removeUnimported).mockResolvedValue({
      count: 1,
      recovery_path: null,
    });
    const user = userEvent.setup();
    render(<LabelingPage />);
    await user.click(
      await screen.findByRole(
        "button",
        { name: "删除未导入 first.psd" },
        { timeout: 5_000 },
      ),
    );
    expect(api.removeUnimported).not.toHaveBeenCalled();
    const dialog = within(screen.getByRole("dialog"));
    vi.mocked(api.listItems).mockResolvedValue(view("first"));

    await user.click(dialog.getByRole("button", { name: "删除" }));

    expect(api.removeUnimported).toHaveBeenCalledExactlyOnceWith("one", ["first.psd"]);
    // 直删改造后不再有待恢复路径的「结果步」：成功即关窗，清单重取后那一行消失。
    expect(
      await screen.findByRole("button", { name: "first.jpg" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "删除未导入 first.psd" }),
    ).not.toBeInTheDocument();
  });

  it("同主干未导入文件独立预览，批量补登记只提交合资格文件", async () => {
    const initial = view("first");
    initial.groups.unimported = [
      {
        item: "first",
        name: "first.psd",
        status: "unimported",
        media: "file",
        can_retry: false,
        in_retry: false,
        reason: "扩展名不支持",
      },
      {
        item: "new",
        name: "new.jpg",
        status: "unimported",
        media: "image",
        can_retry: false,
        in_retry: false,
        reason: "未登记",
      },
    ];
    vi.mocked(api.listItems).mockResolvedValue(initial);
    vi.mocked(api.importMaterials).mockResolvedValue({ task_id: "selected-import" });
    vi.mocked(api.getTask).mockResolvedValue({
      id: "selected-import",
      status: "succeeded",
      progress: 1,
      error: null,
      result: {
        source: "/one",
        imported: ["new.jpg"],
        skipped_identical: [],
        skipped_conflict: [],
        skipped_duplicate: [],
        rejected: [],
      },
    });
    const user = userEvent.setup();
    render(<LabelingPage />);
    await screen.findByRole("button", { name: "first.jpg" });

    await user.click(screen.getByRole("button", { name: /^first\.psd/ }));

    // 舞台缺席的两类（缺失／未导入）点行不进条目预览（媒体舞台④·甲＝不加提示、行外观不弱化）。
    expect(
      screen.queryByRole("heading", { name: "first.psd" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "批次概览" })).toBeInTheDocument();
    // 组头「一键导入」两枚已撤（2026-10-10 用户裁）；行内「导入」点击直接补登记、不经弹窗。
    // 「导入」＝纯图标钮（条目行②），文件名进 aria-label、不合资格的仍不亮。
    const unimported = within(screen.getByRole("region", { name: "未导入" }));
    expect(screen.queryByRole("button", { name: "一键导入" })).not.toBeInTheDocument();
    const blocked = unimported.getByRole("button", { name: "导入 first.psd" });
    const eligible = unimported.getByRole("button", { name: "导入 new.jpg" });
    expect(blocked).toBeDisabled();
    await user.click(eligible);

    await waitFor(() =>
      expect(api.importMaterials).toHaveBeenCalledExactlyOnceWith("one", {
        names: ["new.jpg"],
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(api.listItems).toHaveBeenLastCalledWith("one", "s1"));
  });
  it("折叠和展开保留同一视频元素与播放位置，返回关闭预览", async () => {
    const user = userEvent.setup();
    const initial = view("clip");
    const material = initial.groups.done?.[0];
    if (!material) throw new Error("缺少素材");
    material.name = "clip.mp4";
    material.media = "video";
    vi.mocked(api.listItems).mockResolvedValue(initial);
    render(<LabelingPage />);
    await user.click(await screen.findByRole("button", { name: "clip.mp4" }));
    const video = screen.getByLabelText("clip.mp4") as HTMLVideoElement;
    video.currentTime = 12;

    await user.click(screen.getByRole("button", { name: "折叠为小图" }));

    expect(screen.getByLabelText("clip.mp4")).toBe(video);
    expect(video.currentTime).toBe(12);
    // 折叠态由切换器的文案体现（几何尺寸 jsdom 量不到，视觉口径归 e2e 视觉基线那层）。
    expect(screen.getByRole("button", { name: "展开素材" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "展开素材" }));
    expect(screen.getByLabelText("clip.mp4")).toBe(video);
    expect(video.currentTime).toBe(12);
    expect(screen.getByRole("button", { name: "折叠为小图" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "返回概览" }));
    expect(screen.queryByLabelText("clip.mp4")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "产物预览" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "clip.mp4" })).toBeInTheDocument();
  });
  it("缺失行「重新指定」开目录选择弹窗，选定文件后按新来源直接导入", async () => {
    const user = userEvent.setup();
    const initial = view("first");
    initial.groups.missing = [
      {
        item: "gone",
        name: "gone.jpg",
        media: "image",
        status: "missing",
        can_retry: false,
        in_retry: false,
        recoverable: false,
        source: "D:\\old\\gone.jpg",
      },
    ];
    vi.mocked(api.listItems).mockResolvedValue(initial);
    vi.mocked(api.listDirectory).mockResolvedValue({
      path: "D:/newsource",
      parent: "D:/",
      hostname: "",
      system: "windows",
      is_empty: false,
      entries: [
        {
          kind: "file",
          media: "image",
          is_empty: null,
          name: "gone.jpg",
          path: "D:/newsource/gone.jpg",
          size: 12,
          modified_at: "2026-10-12T00:00:00Z",
        },
      ],
      unavailable_count: 0,
    });
    vi.mocked(api.importMaterials).mockResolvedValue({ task_id: "repoint-task" });
    vi.mocked(api.getTask).mockResolvedValue({
      id: "repoint-task",
      status: "succeeded",
      progress: 1,
      error: null,
      result: null,
    });
    render(<LabelingPage />);
    await screen.findByRole("button", { name: "first.jpg" });

    const missing = within(screen.getByRole("region", { name: "缺失" }));
    await user.click(missing.getByRole("button", { name: "重新指定" }));

    const picker = within(screen.getByRole("dialog"));
    await picker.findByRole("button", { name: /gone\.jpg/ });
    const reads = vi.mocked(api.listItems).mock.calls.length;
    await user.click(picker.getByRole("button", { name: /gone\.jpg/ }));
    await user.click(picker.getByRole("button", { name: "选择此文件" }));

    await waitFor(() =>
      expect(api.importMaterials).toHaveBeenCalledWith("one", {
        source: "D:/newsource",
        names: ["gone.jpg"],
      }),
    );
    expect(vi.mocked(api.listItems).mock.calls.length).toBeGreaterThan(reads);
  });

  it("分组全选后批量加入重试，成功后清空选择并同步重试组", async () => {
    const user = userEvent.setup();
    vi.mocked(api.addRetryItems).mockResolvedValue({
      id: "s1",
      seq: 1,
      items: ["first"],
    });
    render(<LabelingPage />);
    await screen.findByRole("button", { name: "first.jpg" });

    await user.click(
      within(screen.getByRole("complementary", { name: "素材条目" })).getByRole(
        "button",
        { name: "选择" },
      ),
    );
    await user.click(
      within(screen.getByRole("region", { name: "已完成" })).getByRole("button", {
        name: "全选本组",
      }),
    );
    expect(screen.getByRole("checkbox", { name: "选择 first.jpg" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "加入重试(1)" }));

    expect(api.addRetryItems).toHaveBeenCalledWith("one", "s1", ["first"]);
    // 「已选 N」文字随多选条撤除；加入重试成功＝退出多选态（头行回到「选择」钮、勾选整排撤下），
    // 同一条素材在「已完成」与「重试列表」两组各留一份（不是搬走，只是勾不掉了）。
    expect(
      within(screen.getByRole("complementary", { name: "素材条目" })).getByRole(
        "button",
        { name: "选择" },
      ),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox", { name: "选择 first.jpg" })).toHaveLength(
      0,
    );
    expect(
      screen.getAllByRole("button", { name: /first.jpg/, pressed: false }),
    ).toHaveLength(2);
  });

  it("重试行逐条移出后原分组素材保留，重试组随服务端回传消失", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listItems).mockResolvedValue(retryView());
    vi.mocked(api.removeRetryItem).mockResolvedValue({ id: "s1", seq: 1, items: [] });
    render(<LabelingPage />);

    await user.click(await screen.findByRole("button", { name: "移出重试 first.jpg" }));

    expect(api.removeRetryItem).toHaveBeenCalledWith("one", "s1", "first");
    expect(screen.getByRole("button", { name: "first.jpg" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "移出重试 first.jpg" }),
    ).not.toBeInTheDocument();
    // 顶栏「刷新条目」钮已撤（2026-10-07 用户裁）：名单变化只由服务端回传驱动，无手动重取入口。
    expect(screen.queryByRole("button", { name: "清空名单" })).not.toBeInTheDocument();
  });

  it("清空名单以服务端回传为准：没清掉就照实保留，清掉了组才消失", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listItems).mockResolvedValue(retryView());
    vi.mocked(api.clearRetryItems)
      .mockResolvedValueOnce({ id: "s1", seq: 1, items: ["first"] })
      .mockResolvedValue({ id: "s1", seq: 1, items: [] });
    render(<LabelingPage />);

    await user.click(await screen.findByRole("button", { name: "清空名单" }));

    expect(api.clearRetryItems).toHaveBeenCalledWith("one", "s1");
    // 服务端回传「名单里还有它」＝照实保留，不由前端猜成空名单。
    expect(
      screen.getByRole("button", { name: "移出重试 first.jpg" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "清空名单" }));
    expect(api.clearRetryItems).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByRole("button", { name: "移出重试 first.jpg" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "first.jpg" })).toBeInTheDocument();
  });

  it("同一条目在两组各占一行：点哪行只亮哪行，不再两行同时亮", async () => {
    const user = userEvent.setup();
    const initial = view("first");
    const row = initial.groups.done?.[0];
    if (!row) throw new Error("缺少测试素材");
    row.in_retry = true;
    initial.groups.retry = [row];
    vi.mocked(api.listItems).mockResolvedValue(initial);
    render(<LabelingPage />);

    await screen.findByRole("button", { name: "移出重试 first.jpg" });
    const { original, retry } = retriedRowPair();
    await user.click(retry);

    expect(retry).toHaveAttribute("aria-pressed", "true");
    expect(original).toHaveAttribute("aria-pressed", "false");
    await user.click(original);
    expect(original).toHaveAttribute("aria-pressed", "true");
    expect(retry).toHaveAttribute("aria-pressed", "false");
  });

  it("清空请求失败时保留重试名单并呈现原因", async () => {
    const user = userEvent.setup();
    const initial = view("first");
    const row = initial.groups.done?.[0];
    if (!row) throw new Error("缺少测试素材");
    row.in_retry = true;
    initial.groups.retry = [row];
    vi.mocked(api.listItems).mockResolvedValue(initial);
    vi.mocked(api.clearRetryItems).mockRejectedValue(new Error("暂时不可写"));
    render(<LabelingPage />);

    await user.click(await screen.findByRole("button", { name: "清空名单" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("暂时不可写");
    expect(
      screen.getByRole("button", { name: "移出重试 first.jpg" }),
    ).toBeInTheDocument();
  });

  it("加载真实批次清单、搜索并预览素材", async () => {
    const user = userEvent.setup();
    render(<LabelingPage />);

    await user.click(await screen.findByRole("button", { name: "first.jpg" }));

    expect(screen.getByRole("img", { name: "first.jpg" })).toHaveAttribute(
      "src",
      "/api/workdirs/one/items/first/asset",
    );
    expect(api.listItems).toHaveBeenCalledWith("one", "s1");
    await user.type(screen.getByRole("textbox", { name: "搜索条目" }), "absent");
    expect(screen.queryByRole("button", { name: "first.jpg" })).not.toBeInTheDocument();
  });

  it("切换目录后旧请求迟到不能覆盖当前条目", async () => {
    const user = userEvent.setup();
    let resolveOld:
      | ((value: components["schemas"]["ItemListView"]) => void)
      | undefined;
    vi.mocked(api.listItems).mockImplementation((wid) =>
      wid === "one"
        ? new Promise((resolve) => {
            resolveOld = resolve;
          })
        : Promise.resolve(view("second")),
    );
    render(<LabelingPage />);

    await screen.findByText("目录一");
    await user.click(screen.getByRole("button", { name: "选择工作目录与批次" }));
    await user.click(
      await within(screen.getByRole("group", { name: "目录二" })).findByRole(
        "menuitem",
      ),
    );
    await screen.findByRole("button", { name: "second.jpg" });
    await act(async () => {
      resolveOld?.(view("stale"));
    });

    expect(screen.queryByText("stale.jpg")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "second.jpg" })).toBeInTheDocument();
  });

  it("目录加载失败不进页面横幅，业务类失败行只落在弹层内（挂账第 1 条裁决 B）", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listWorkdirs).mockRejectedValue(new Error("服务不可用"));
    render(<LabelingPage />);

    await user.click(screen.getByRole("button", { name: "选择工作目录与批次" }));
    // 单一通路（ADR「workdir 取数失败不进页面横幅」）：业务类失败由弹层失败行就地表达，
    // 横幅不再收这条链路——旧断言「横幅显示服务不可用」随该裁决一起退役。
    expect(await screen.findByText("工作目录读取失败")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("切页记忆与状态章", () => {
  function twoBatches(): void {
    vi.mocked(api.listBatches).mockResolvedValue([
      {
        id: "s1",
        seq: 1,
        name: "策略",
        active: true,
        created_at: "",
        description: "",
        product_count: 1,
      },
      {
        id: "s2",
        seq: 2,
        name: "策略二",
        active: true,
        created_at: "",
        description: "",
        product_count: 1,
      },
    ]);
  }

  it("切页重挂载后恢复上次的批次选择而非回退默认", async () => {
    twoBatches();
    const user = userEvent.setup();
    const first = render(<LabelingPage />);
    await first.findByRole("button", { name: "first.jpg" });

    await user.click(screen.getByRole("button", { name: "选择工作目录与批次" }));
    // twoBatches 对两个目录都生效，菜单里有两个 /s2/——限定在目录一组内点。
    await user.click(
      await within(screen.getByRole("group", { name: "目录一" })).findByRole(
        "menuitem",
        { name: /s2/ },
      ),
    );
    await screen.findByRole("button", { name: "first.jpg" });
    first.unmount();

    render(<LabelingPage />);
    await screen.findByRole("button", { name: "first.jpg" });
    expect(api.listItems).toHaveBeenLastCalledWith("one", "s2");
    await user.click(screen.getByRole("button", { name: "选择工作目录与批次" }));
    // 当前行标记＝aria-current（绿勾已撤，tint＋左线＋aria-current 三重信号）
    expect(
      await within(screen.getByRole("group", { name: "目录一" })).findByRole(
        "menuitem",
        { name: /s2/ },
      ),
    ).toHaveAttribute("aria-current", "true");
  });

  it("localStorage 里的失效批次回退到默认选择", async () => {
    twoBatches();
    localStorage.setItem(
      "dsf-labeling-selection",
      JSON.stringify({ workdirId: "ghost", batchId: "g1" }),
    );
    render(<LabelingPage />);

    await screen.findByRole("button", { name: "first.jpg" });
    expect(api.listItems).toHaveBeenLastCalledWith("one", "s1");
    // 对账前置（2026-09-23）：失效候选在提交前就被拦下，绝不按它发取数请求。
    expect(api.listItems).not.toHaveBeenCalledWith("ghost", "g1");
  });

  it("记忆 wid 已不在注册表（如删过数据根）：不发失效请求，静默回退空态", async () => {
    vi.mocked(api.listWorkdirs).mockResolvedValue([]);
    localStorage.setItem(
      "dsf-labeling-selection",
      JSON.stringify({ workdirId: "AE-zVzxTrdI", batchId: "s1" }),
    );
    render(<LabelingPage />);

    await screen.findByText("还没有可用批次");
    expect(api.listItems).not.toHaveBeenCalled();
    expect(api.currentRun).not.toHaveBeenCalled();
    expect(screen.queryByText(/不在注册表中/)).not.toBeInTheDocument();
  });

  it("空闲上报回读磁盘终态而不是抹掉状态章", async () => {
    vi.mocked(api.currentRun).mockResolvedValue(null);
    vi.mocked(api.latestRun).mockResolvedValue({
      record: {
        run_id: "r1",
        batch: 1,
        mode: "full",
        status: "completed",
        started_at: "2026-09-22T00:00:00Z",
        finished_at: "2026-09-22T00:01:00Z",
        counters: {
          attempted: 0,
          failed: 0,
          planned: 0,
          skipped: 0,
          succeeded: 0,
        },
        dsf_version: "0.1.0",
        snapshot: "",
        strategy_hash: "",
        trigger: "manual",
      },
      log_path: null,
      items_path: null,
    });
    render(<LabelingPage />);

    // 挂载后先由 latestRun 读到终态，随后 RunControl 探测空闲报 idle——
    // idle 必须触发重读而不是把刚显示的「已完成」图标抹掉。（重读是幂等轻量磁盘读，
    // 测试环境下 idle 上报可能与 selection 校验重设交织出多轮，只断言下界。
    // 触发钮的可访问名固定，「已完成」图标断言限定在胶囊内。）
    const capsule = (): HTMLElement =>
      screen.getByRole("button", { name: "选择工作目录与批次" });
    await waitFor(() =>
      expect(
        within(capsule()).getByRole("img", { name: "已完成" }),
      ).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(vi.mocked(api.latestRun).mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    await waitFor(() =>
      expect(
        within(capsule()).getByRole("img", { name: "已完成" }),
      ).toBeInTheDocument(),
    );
  });

  it("左列分组折叠状态重挂载后保留", async () => {
    const user = userEvent.setup();
    const first = render(<LabelingPage />);
    await first.findByRole("button", { name: "first.jpg" });
    const header = screen.getByRole("button", { name: /已完成/ });
    expect(header).toHaveAttribute("aria-expanded", "true");
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    first.unmount();

    render(<LabelingPage />);
    const restored = await screen.findByRole("button", { name: /已完成/ });
    expect(restored).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "first.jpg" })).not.toBeInTheDocument();
  });

  it("组内展开状态重挂载后保留", async () => {
    const initial = view("first");
    initial.groups.done = Array.from({ length: 5 }, (_, index) => ({
      item: `n${index}`,
      name: `n${index}.jpg`,
      status: "done" as const,
      media: "image" as const,
      in_retry: false,
      can_retry: true,
    }));
    vi.mocked(api.listItems).mockResolvedValue(initial);
    const user = userEvent.setup();
    const first = render(<LabelingPage />);
    await first.findByRole("button", { name: "n0.jpg" });

    await user.click(screen.getByRole("button", { name: /其余 1 条/ }));
    expect(screen.getByRole("button", { name: "n4.jpg" })).toBeInTheDocument();
    first.unmount();

    render(<LabelingPage />);
    expect(await screen.findByRole("button", { name: "n4.jpg" })).toBeInTheDocument();
  });
});

describe("跨重启恢复", () => {
  it("选中的素材跨重启恢复：启动后首次装载按 localStorage 回选", async () => {
    localStorage.setItem(
      "dsf-labeling-selection",
      JSON.stringify({ workdirId: "one", batchId: "s1" }),
    );
    localStorage.setItem("dsf-labeling-selected-item", JSON.stringify("first"));
    render(<LabelingPage />);

    const row = await screen.findByRole("button", { name: "first.jpg" });
    await waitFor(() => expect(row).toHaveAttribute("aria-pressed", "true"));
  });

  it("存档带组前缀：恢复只亮存的那个组那行", async () => {
    const initial = view("first");
    const row = initial.groups.done?.[0];
    if (!row) throw new Error("缺少测试素材");
    row.in_retry = true;
    initial.groups.retry = [row];
    vi.mocked(api.listItems).mockResolvedValue(initial);
    localStorage.setItem(
      "dsf-labeling-selection",
      JSON.stringify({ workdirId: "one", batchId: "s1" }),
    );
    localStorage.setItem("dsf-labeling-selected-item", JSON.stringify("retry:first"));
    render(<LabelingPage />);

    await screen.findByRole("button", { name: "移出重试 first.jpg" });
    const { original, retry } = retriedRowPair();
    await waitFor(() => expect(retry).toHaveAttribute("aria-pressed", "true"));
    expect(original).toHaveAttribute("aria-pressed", "false");
  });

  it("旧档存裸条目键（无组）：恢复退化落原分组那行", async () => {
    const initial = view("first");
    const row = initial.groups.done?.[0];
    if (!row) throw new Error("缺少测试素材");
    row.in_retry = true;
    initial.groups.retry = [row];
    vi.mocked(api.listItems).mockResolvedValue(initial);
    localStorage.setItem(
      "dsf-labeling-selection",
      JSON.stringify({ workdirId: "one", batchId: "s1" }),
    );
    localStorage.setItem("dsf-labeling-selected-item", JSON.stringify("first"));
    render(<LabelingPage />);

    await screen.findByRole("button", { name: "移出重试 first.jpg" });
    const { original, retry } = retriedRowPair();
    await waitFor(() => expect(original).toHaveAttribute("aria-pressed", "true"));
    expect(retry).toHaveAttribute("aria-pressed", "false");
  });

  it("恢复的素材 id 已不在装载结果里：静默放弃，不误选", async () => {
    localStorage.setItem(
      "dsf-labeling-selection",
      JSON.stringify({ workdirId: "one", batchId: "s1" }),
    );
    localStorage.setItem("dsf-labeling-selected-item", JSON.stringify("ghost"));
    render(<LabelingPage />);

    const row = await screen.findByRole("button", { name: "first.jpg" });
    await waitFor(() => expect(row).toHaveAttribute("aria-pressed", "false"));
  });

  it("左列筛选词跨重启恢复：搜索框带出上次的词", async () => {
    localStorage.setItem(
      "dsf-labeling-selection",
      JSON.stringify({ workdirId: "one", batchId: "s1" }),
    );
    localStorage.setItem("dsf-labeling-query", JSON.stringify("first"));
    render(<LabelingPage />);

    await screen.findByRole("button", { name: "first.jpg" });
    expect(screen.getByPlaceholderText("搜索条目")).toHaveValue("first");
  });

  it("未持久化时保持旧默认：无 selection 存档即回默认选择", async () => {
    localStorage.setItem(
      "dsf-labeling-selection",
      JSON.stringify({ workdirId: "one", batchId: "s1" }),
    );
    render(<LabelingPage />);

    await screen.findByRole("button", { name: "first.jpg" });
    expect(screen.getByPlaceholderText("搜索条目")).toHaveValue("");
    // 首个目录的首个批次（既有默认链），选中素材为空。
    expect(screen.queryByRole("button", { name: "first.jpg" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});
