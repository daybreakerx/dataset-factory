import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, type TaskView } from "../../../api";
import { TooltipProvider } from "../../../components/ui/tooltip";
import { NewBatchForm } from "./NewBatchForm";

vi.mock("../../../api", async (original) => ({
  ...(await original<typeof import("../../../api")>()),
  api: {
    listStrategies: vi.fn(),
    listEndpoints: vi.fn(),
    listPrompts: vi.fn(),
    listSkills: vi.fn(),
    createWorkdir: vi.fn(),
    importMaterials: vi.fn(),
    getTask: vi.fn(),
    createBatch: vi.fn(),
    scanSource: vi.fn(),
    startRun: vi.fn(),
  },
}));

const SCAN = {
  total: 3,
  images: 2,
  videos: 1,
  unimported: [
    { name: "a.psd", media: "file", reason: "扩展名不支持", size: 10, limit: null },
    { name: "b.psd", media: "file", reason: "扩展名不支持", size: 10, limit: null },
    { name: "big.mov", media: "video", reason: "超出大小上限", size: 10, limit: 5 },
  ],
};

/** 导入长任务的完成态载荷（分档计数由后端算好，界面不抄扩展名对照表）。 */
const IMPORT_DONE: TaskView = {
  id: "initial",
  status: "succeeded",
  progress: 1,
  error: null,
  result: {
    source: "/source",
    imported: ["cat.jpg", "dog.jpg", "clip.mp4"],
    imported_images: 2,
    imported_videos: 1,
    skipped_identical: [],
    skipped_conflict: [],
    skipped_duplicate: [],
    rejected: [{ name: "a.psd", reason: "扩展名不支持" }],
  },
};

function renderForm(props: { onCreated?: () => void } = {}): void {
  render(
    <TooltipProvider>
      <NewBatchForm onBack={vi.fn()} onCreated={props.onCreated ?? vi.fn()} />
    </TooltipProvider>,
  );
}

/** 信息行是一句拆成多节点的话，整句断言取容器文本（RTL 的 getByText 只吃直接文本子节点）。 */
function infoLine(): HTMLElement {
  return screen.getByTestId("source-info");
}

async function fillDirectories(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.type(screen.getByRole("textbox", { name: "来源目录" }), "/source");
  await user.type(screen.getByRole("textbox", { name: "工作目录" }), "/work");
  await user.type(screen.getByRole("textbox", { name: "策略名" }), "Test");
}

async function importAssets(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("button", { name: "扫描" }));
  await waitFor(() => expect(api.scanSource).toHaveBeenCalled());
  await user.click(screen.getByRole("button", { name: "导入" }));
  await waitFor(() => expect(infoLine()).toHaveTextContent("已导入 3 项"));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.scanSource).mockResolvedValue(SCAN);
  vi.mocked(api.listStrategies).mockResolvedValue([]);
  vi.mocked(api.listSkills).mockResolvedValue([]);
  vi.mocked(api.listPrompts).mockResolvedValue([
    { id: "p-caption-01", name: "caption", description: "", body_chars: 0 },
  ]);
  vi.mocked(api.listEndpoints).mockResolvedValue([
    {
      id: "e-model-x1111",
      name: "model",
      model: "test",
      has_api_key: true,
      base_url: "https://example.invalid",
      api_format: "openai-chat-completions",
      request_params: {},
    },
  ]);
  vi.mocked(api.createWorkdir).mockResolvedValue({
    task_id: "initial",
    workdir: { id: "work", title: "work", path: "/work", last_used_at: 0 },
  });
  vi.mocked(api.importMaterials).mockResolvedValue({ task_id: "retry" });
  vi.mocked(api.getTask).mockResolvedValue(IMPORT_DONE);
  vi.mocked(api.createBatch).mockResolvedValue({
    id: "s1",
    seq: 1,
    name: "Test",
    description: "",
    active: true,
    created_at: "",
    product_count: 0,
  });
});

describe("新建批次·表单头与素材来源", () => {
  it("扫描对象是来源目录，未导入原因就地内联计数（不再指向发车前确认）", async () => {
    const user = userEvent.setup();
    renderForm();

    // 没填目录就没有扫描对象（笔④：扫描钮解禁＝来源目录非空）。
    expect(screen.getByRole("button", { name: "扫描" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "扫描" }));
    expect(api.scanSource).not.toHaveBeenCalled();

    await user.type(screen.getByRole("textbox", { name: "来源目录" }), "/source");
    await user.click(screen.getByRole("button", { name: "扫描" }));

    await waitFor(() =>
      expect(api.scanSource).toHaveBeenCalledExactlyOnceWith("/source"),
    );
    expect(infoLine()).toHaveTextContent(
      "扫描到 3 项：图片 2 · 视频 1；未导入 3 项（2 个扩展名不支持 · 1 个超出大小上限）",
    );
  });

  it("导入才登记与复制，完成行给分档与拒收缀；此前「创建批次」恒禁用", async () => {
    const user = userEvent.setup();
    renderForm();
    await fillDirectories(user);
    expect(screen.getByRole("button", { name: "创建批次" })).toBeDisabled();

    await importAssets(user);

    expect(api.createWorkdir).toHaveBeenCalledExactlyOnceWith({
      path: "/work",
      source: "/source",
      title: "",
    });
    expect(api.importMaterials).not.toHaveBeenCalled();
    expect(infoLine()).toHaveTextContent("已导入 3 项（图片 2 · 视频 1） · 拒收 1 项");
    expect(within(infoLine()).getByText("· 拒收 1 项")).toHaveClass("text-bad-ink");
    // 完成态冻结（笔⑩）：分段、两枚输入与选择钮一起锁。
    expect(screen.getByRole("tab", { name: "复制导入" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "来源目录" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "选择来源目录" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "选择工作目录" })).toBeDisabled();
    // 扫过一遍后钮位改口「重新扫描」，导入完成后两钮一起消失（格 4）。
    expect(screen.queryByRole("button", { name: /扫描/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导入" })).not.toBeInTheDocument();
  });

  it("头行「创建批次」只做创建，成功后回主页面、不再由表单发车", async () => {
    const onCreated = vi.fn();
    const user = userEvent.setup();
    renderForm({ onCreated });
    await fillDirectories(user);
    await importAssets(user);

    await user.click(screen.getByRole("button", { name: "创建批次" }));

    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledExactlyOnceWith({
        workdirId: "work",
        batchId: "s1",
      }),
    );
    expect(api.createBatch).toHaveBeenCalledExactlyOnceWith("work", {
      type: "scratch",
      name: "Test",
      // 下拉的取值身份由 useBatchFormLists 给（本套件的两列表数据用名字当身份）。
      endpoint_id: "model",
      prompt_id: "caption",
      skill_ids: [],
    });
    // 启动归主页面的「开始打标」（笔⑥：语义拆分，运行状态组现役件承载）。
    expect(api.startRun).not.toHaveBeenCalled();
    expect(api.createWorkdir).toHaveBeenCalledOnce();
  });

  it("创建失败落头行消息槽、用后端真话，钮恢复可重试", async () => {
    const user = userEvent.setup();
    vi.mocked(api.createBatch).mockRejectedValueOnce(
      new ApiError("http", "工作目录正在维护", 409, null),
    );
    renderForm();
    await fillDirectories(user);
    await importAssets(user);
    const create = screen.getByRole("button", { name: "创建批次" });
    expect(create).toBeEnabled();

    await user.click(create);

    const slot = await screen.findByRole("alert");
    expect(slot).toHaveTextContent("工作目录正在维护");
    expect(create).toBeEnabled();
    expect(screen.queryByText("正在创建批次")).not.toBeInTheDocument();
  });

  it("就地态：字段标题收成「目录」、警告句在场、登记走 source=null", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByRole("textbox", { name: "工作目录" }), "/live");

    // 笔⑪：切到就地立刻在信息区给警告（无底琥珀字），必勾复选框整段撤。
    await user.click(screen.getByRole("tab", { name: "就地采用" }));
    expect(
      await screen.findByText("直接使用素材目录作为工作目录，删除目录后素材会丢失"),
    ).toBeInTheDocument();
    expect(screen.queryByText("目录", { exact: true })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "来源目录" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "扫描" }));
    await waitFor(() =>
      expect(api.scanSource).toHaveBeenCalledExactlyOnceWith("/live"),
    );
    expect(
      within(infoLine()).queryByText(/删除目录后素材会丢失/),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "登记" }));

    await waitFor(() =>
      expect(api.createWorkdir).toHaveBeenCalledExactlyOnceWith({
        path: "/live",
        source: null,
        title: "",
      }),
    );
    expect(infoLine()).toHaveTextContent("已登记 3 项（图片 2 · 视频 1）");
  });

  it("扫描失败就地给红字且原地可重试（撤空 catch 的静默）", async () => {
    const user = userEvent.setup();
    vi.mocked(api.scanSource).mockRejectedValueOnce(
      new ApiError(
        "http",
        "来源目录「/gone」不存在或不是目录——请检查后重试。",
        404,
        null,
      ),
    );
    renderForm();
    await user.type(screen.getByRole("textbox", { name: "来源目录" }), "/gone");

    await user.click(screen.getByRole("button", { name: "扫描" }));

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("不存在或不是目录——请检查后重试。");
    expect(screen.getByRole("button", { name: "重新扫描" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "重新扫描" }));

    await waitFor(() => expect(infoLine()).toHaveTextContent("扫描到 3 项"));
  });

  it("在飞任务丢失后重按导入只补发导入、不重复登记工作目录", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getTask).mockRejectedValueOnce(
      new ApiError("http", "lost", 404, null),
    );
    vi.mocked(api.getTask).mockResolvedValue({ ...IMPORT_DONE, id: "retry" });
    renderForm();
    await fillDirectories(user);

    await user.click(screen.getByRole("button", { name: "扫描" }));
    await user.click(screen.getByRole("button", { name: "导入" }));
    await screen.findByRole("alert");
    expect(api.createBatch).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "导入" }));

    await waitFor(() => expect(infoLine()).toHaveTextContent("已导入 3 项"));
    expect(api.createWorkdir).toHaveBeenCalledOnce();
    expect(api.importMaterials).toHaveBeenCalledExactlyOnceWith("work", {
      source: "/source",
    });
    expect(api.getTask).toHaveBeenLastCalledWith("retry");
  });

  it("改来源目录后旧扫描作废、就地警告回显", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByRole("textbox", { name: "来源目录" }), "/source");
    await user.click(screen.getByRole("button", { name: "扫描" }));
    await waitFor(() => expect(infoLine()).toHaveTextContent("扫描到 3 项"));

    await user.click(screen.getByRole("tab", { name: "就地采用" }));

    // 换档＝换扫描对象，旧摘要不再作数，信息区退回该档的空信息（就地即那句警告）。
    expect(infoLine()).toHaveTextContent("直接使用素材目录作为工作目录");
    expect(screen.getByRole("button", { name: "扫描" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "登记" })).not.toBeInTheDocument();
  });

  it("选中库策略后策略内容三行只读在场、值取来源引用、策略名回填", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listStrategies).mockResolvedValue([
      {
        id: "lib-1",
        name: "库策略",
        description: "",
        endpoint_id: "e-model-x1111",
        endpoint_name: "model",
        prompt_id: "p-caption-01",
        prompt_name: "caption",
        skill_ids: [],
        available: true,
        damaged: false,
        missing_refs: [],
        body_chars: 10,
        created_at: "",
        updated_at: "",
      },
    ]);
    renderForm();

    await user.click(screen.getByRole("button", { name: "策略来源" }));
    await user.click(await screen.findByRole("menuitem", { name: /库策略/ }));

    // 归一补笔：三行恒渲染，库应用态是只读展示（灰底＝disabled）、值取来源引用。
    expect(screen.getByRole("textbox", { name: "策略名" })).toHaveValue("库策略");
    for (const label of ["端点配置", "基础提示词", "Skill"]) {
      expect(screen.getByRole("button", { name: label })).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: "端点配置" })).toHaveTextContent("model");
    expect(screen.getByRole("button", { name: "基础提示词" })).toHaveTextContent(
      "caption",
    );
    expect(screen.getByRole("button", { name: "Skill" })).toHaveTextContent("未选");
    // 库策略态的解禁条件不再吃从零那三项（笔⑥：策略齐＝来源已定）。
    await user.type(screen.getByRole("textbox", { name: "来源目录" }), "/source");
    await user.type(screen.getByRole("textbox", { name: "工作目录" }), "/work");
    await user.click(screen.getByRole("button", { name: "扫描" }));
    await user.click(screen.getByRole("button", { name: "导入" }));
    await waitFor(() => expect(infoLine()).toHaveTextContent("已导入 3 项"));
    expect(screen.getByRole("button", { name: "创建批次" })).toBeEnabled();
  });

  it("Skill 弹层按 id 勾选、回显顿号，停用候选不列出，提交体吃 id", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listSkills).mockResolvedValue([
      {
        id: "sk-1",
        name: "风格约束",
        description: "口语化",
        enabled: true,
        body_chars: 12,
        damage_file: "",
        damage_kind: null,
      },
      {
        id: "sk-2",
        name: "结构检查",
        description: "",
        enabled: false,
        body_chars: 6,
        damage_file: "",
        damage_kind: null,
      },
    ]);
    renderForm();
    await user.type(screen.getByRole("textbox", { name: "来源目录" }), "/source");
    await user.type(screen.getByRole("textbox", { name: "工作目录" }), "/work");
    await user.type(screen.getByRole("textbox", { name: "策略名" }), "Test");

    await user.click(screen.getByRole("button", { name: "Skill" }));
    // 停用候选不列（笔④「过滤不列」——「（已停用）」缀与禁用行一并撤）。
    await screen.findByRole("menuitemcheckbox", { name: /风格约束/ });
    expect(
      screen.queryByRole("menuitemcheckbox", { name: /结构检查/ }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitemcheckbox", { name: /风格约束/ }));
    // 点选不关层（族规）——关层后才回看触发件的回显（层开着时页面内容 aria-hidden）。
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Skill" })).toHaveTextContent("风格约束");

    await user.click(screen.getByRole("button", { name: "扫描" }));
    await user.click(screen.getByRole("button", { name: "导入" }));
    await waitFor(() => expect(infoLine()).toHaveTextContent("已导入 3 项"));
    await user.click(screen.getByRole("button", { name: "创建批次" }));

    await waitFor(() => expect(api.createBatch).toHaveBeenCalledOnce());
    expect(vi.mocked(api.createBatch).mock.calls[0]?.[1]).toMatchObject({
      skill_ids: ["sk-1"],
    });
  });

  it("库表拉不到时三行说「配置读取失败」，不把拉不到说成库里没有", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listEndpoints).mockRejectedValue(
      new ApiError("network", "连不上后端", null, null),
    );
    renderForm();

    await user.click(screen.getByRole("button", { name: "端点配置" }));

    expect(await screen.findByText("配置读取失败")).toBeInTheDocument();
    expect(screen.queryByText("还没有可用的端点配置")).not.toBeInTheDocument();
  });

  it("不可用的库策略是坏行：红缀短式＋点行唤起「重新指定」弹窗（2026-10-13 E4）", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listStrategies).mockResolvedValue([
      {
        id: "lib1",
        name: "库策略",
        description: "",
        endpoint_id: "e-model-x1111",
        prompt_id: "p-caption-01",
        skill_ids: [],
        endpoint_name: "model",
        prompt_name: "caption",
        body_chars: 12,
        available: false,
        missing_refs: ["提示词"],
        damaged: false,
        created_at: "",
        updated_at: "",
      },
    ]);
    renderForm();

    await user.click(screen.getByRole("button", { name: "策略来源" }));

    const row = await screen.findByRole("menuitem", { name: /库策略/ });
    expect(row).toHaveAttribute("data-row", "bad");
    // 坏行档＝名行红缀短式＋描述位点击出口（E4 后不再写「去策略页」去处句）。
    expect(row).toHaveTextContent("引用缺失");
    expect(row).toHaveTextContent("不可应用 · 点击重新指定");
    // 出口＝本表单点坏行直接开「重新指定」弹窗（来源下拉收起、不叠层）。
    await user.click(row);

    expect(await screen.findByText("重新指定「库策略」")).toBeInTheDocument();
  });
});
