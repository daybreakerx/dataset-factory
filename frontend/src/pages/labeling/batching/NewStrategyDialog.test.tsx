import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../api";
import { NewStrategyDialog } from "./NewStrategyDialog";

vi.mock("../../../api", async (original) => ({
  ...(await original<typeof import("../../../api")>()),
  api: {
    listStrategies: vi.fn(),
    listEndpoints: vi.fn(),
    listPrompts: vi.fn(),
    listSkills: vi.fn(),
    createBatch: vi.fn(),
    startRun: vi.fn(),
  },
}));

const AVAILABLE = {
  id: "lib1",
  name: "库策略",
  description: "",
  endpoint_id: "e-model-x1111",
  prompt_id: "p-caption-01",
  skill_ids: ["sk-1"],
  endpoint_name: "model",
  prompt_name: "caption",
  body_chars: 12_400,
  available: true,
  missing_refs: [],
  damaged: false,
  created_at: "",
  updated_at: "",
};

const BROKEN = {
  ...AVAILABLE,
  id: "lib2",
  name: "实验·极简",
  available: false,
  missing_refs: ["端点配置「gone」不存在"],
};

function renderDialog(props: {
  onCreated?: () => void;
  onClose?: () => void;
  onNavigateToSettings?: () => void;
  onOpenWorkbench?: () => void;
}): ReactElement {
  return (
    <NewStrategyDialog
      wid="work"
      title="素材"
      nextSeq={4}
      onClose={props.onClose ?? vi.fn()}
      onCreated={props.onCreated ?? vi.fn()}
      onNavigateToSettings={props.onNavigateToSettings}
      onOpenWorkbench={props.onOpenWorkbench}
    />
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.listStrategies).mockResolvedValue([]);
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
      name: "镜头术语",
      description: "",
      enabled: true,
      body_chars: 6,
      damage_file: "",
      damage_kind: null,
    },
  ]);
  vi.mocked(api.listPrompts).mockResolvedValue([
    { id: "p-caption-01", name: "caption", description: "", body_chars: 0 },
  ]);
  vi.mocked(api.listEndpoints).mockResolvedValue([
    {
      id: "e-model-x1111",
      name: "model",
      model: "vision",
      has_api_key: true,
      base_url: "https://example.invalid",
      api_format: "openai-chat-completions",
      request_params: {},
    },
  ]);
  vi.mocked(api.createBatch).mockResolvedValue({
    id: "s4",
    seq: 4,
    name: "新策略",
    description: "",
    active: true,
    created_at: "",
    product_count: 0,
  });
});

describe("新增策略弹窗", () => {
  it("名框带占位示例，只在指定目录创建策略且不启动跑批", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    render(
      <NewStrategyDialog
        wid="work"
        title="素材"
        nextSeq={4}
        onClose={vi.fn()}
        onCreated={onCreated}
      />,
    );
    expect(screen.getByRole("textbox", { name: "策略名" })).toHaveAttribute(
      "placeholder",
      "例如：标签式短句",
    );

    await user.type(screen.getByRole("textbox", { name: "策略名" }), "新策略");
    await user.click(screen.getByRole("button", { name: "创建策略" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(api.createBatch).toHaveBeenCalledExactlyOnceWith("work", {
      type: "scratch",
      name: "新策略",
      endpoint_id: "e-model-x1111",
      prompt_id: "p-caption-01",
      skill_ids: [],
    });
    expect(api.startRun).not.toHaveBeenCalled();
  });

  it("等待与失败都只写在弹层内一行，表单级进度行与页脚重试钮撤", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listPrompts).mockRejectedValue(new Error("配置读取失败"));
    render(renderDialog({}));

    await user.click(screen.getByRole("button", { name: "端点配置" }));
    const layer = await screen.findByRole("menu");
    expect(await within(layer).findByText(/配置读取失败/)).toHaveTextContent(
      "关掉再开此层可重试",
    );
    expect(
      screen.queryByRole("button", { name: "重试读取配置" }),
    ).not.toBeInTheDocument();
  });

  it("重开弹层即重拉：一次失败后重开就恢复到可用列表", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listPrompts).mockRejectedValueOnce(new Error("配置读取失败"));
    render(renderDialog({}));

    await user.click(screen.getByRole("button", { name: "端点配置" }));
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "端点配置" }));

    const reopened = await screen.findByRole("menu");
    await waitFor(() =>
      expect(within(reopened).getByText("model · vision")).toBeInTheDocument(),
    );
    // 开窗拉一次 ＋ 每次开弹层再拉一次（笔⑦「重开弹层即重拉＝重试」）。
    expect(api.listPrompts).toHaveBeenCalledTimes(3);
  });

  it("三枚弹层空清单各有一句族句式，不再零文案", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listEndpoints).mockResolvedValue([]);
    vi.mocked(api.listPrompts).mockResolvedValue([]);
    vi.mocked(api.listSkills).mockResolvedValue([]);
    render(renderDialog({}));

    await user.click(screen.getByRole("button", { name: "端点配置" }));
    expect(await screen.findByText("还没有可用的端点配置")).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "基础提示词" }));
    expect(await screen.findByText("还没有可用的基础提示词")).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "Skill" }));
    expect(await screen.findByText("还没有可用的 Skill")).toBeInTheDocument();
    await user.keyboard("{Escape}");

    // 空选回显＝「未选」（笔⑪族句式），顿号拼接由下一条覆盖。
    expect(screen.getByRole("button", { name: "Skill" })).toHaveTextContent("未选");
  });

  it("引用缺失的库项是坏行：红缀短式＋去处句、aria-disabled 不给处置出口", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listStrategies).mockResolvedValue([AVAILABLE, BROKEN]);
    render(renderDialog({}));

    await user.click(screen.getByRole("button", { name: "策略来源" }));
    const broken = await screen.findByRole("menuitem", { name: /实验·极简/ });
    expect(broken).toHaveAttribute("aria-disabled", "true");
    expect(broken).toHaveTextContent("引用缺失");
    expect(broken).toHaveTextContent("不可应用 · 到「策略」页重新指定后可用");
    await user.keyboard("{Escape}");

    // 本窗不给处置出口（弹窗不叠弹窗）：来源仍是「从零配置」。
    expect(screen.getByRole("button", { name: "策略来源" })).toHaveTextContent(
      "从零配置",
    );
  });

  it("选中库策略后三行只读在场、值取来源引用，提交吃库 ID", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    vi.mocked(api.listStrategies).mockResolvedValue([AVAILABLE, BROKEN]);
    render(renderDialog({ onCreated }));

    await user.click(screen.getByRole("button", { name: "策略来源" }));
    await user.click(await screen.findByRole("menuitem", { name: /库策略/ }));

    expect(screen.getByRole("textbox", { name: "策略名" })).toHaveValue("库策略");
    for (const label of ["端点配置", "基础提示词", "Skill"]) {
      expect(screen.getByRole("button", { name: label })).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: "端点配置" })).toHaveTextContent("model");
    expect(screen.getByRole("button", { name: "Skill" })).toHaveTextContent("风格约束");

    await user.click(screen.getByRole("button", { name: "创建策略" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(api.createBatch).toHaveBeenCalledExactlyOnceWith("work", {
      type: "library",
      id: "lib1",
      name: "库策略",
    });
  });

  it("Skill 多选按 id 存取、回显顿号拼接", async () => {
    const user = userEvent.setup();
    render(renderDialog({}));
    await user.type(screen.getByRole("textbox", { name: "策略名" }), "新策略");

    await user.click(screen.getByRole("button", { name: "Skill" }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: /镜头术语/ }));
    // 点选不关层（族规）：连着勾第二枚也一次到位。
    await user.click(screen.getByRole("menuitemcheckbox", { name: /风格约束/ }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Skill" })).toHaveTextContent(
      "镜头术语、风格约束",
    );

    await user.click(screen.getByRole("button", { name: "创建策略" }));

    await waitFor(() => expect(api.createBatch).toHaveBeenCalledOnce());
    expect(vi.mocked(api.createBatch).mock.calls[0]?.[1]).toMatchObject({
      skill_ids: ["sk-2", "sk-1"],
    });
  });

  it("齿轮跳该库管理处且不关本窗", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onNavigateToSettings = vi.fn();
    render(renderDialog({ onClose, onNavigateToSettings }));

    await user.click(screen.getByRole("button", { name: "端点配置" }));
    await user.click(
      await screen.findByRole("button", { name: "前往设置 · 端点配置" }),
    );

    expect(onNavigateToSettings).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("新增策略")).toBeInTheDocument();
  });

  it("创建失败保留输入并落标题行右侧消息槽，重试成功只通知一次", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    vi.mocked(api.createBatch).mockRejectedValueOnce(new Error("引用已变化"));
    render(renderDialog({ onCreated }));
    await user.type(screen.getByRole("textbox", { name: "策略名" }), "新策略");

    await user.click(screen.getByRole("button", { name: "创建策略" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("引用已变化");
    expect(screen.getByRole("textbox", { name: "策略名" })).toHaveValue("新策略");
    await user.click(screen.getByRole("button", { name: "创建策略" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(api.createBatch).toHaveBeenCalledTimes(2);
  });

  it("飞行期不拦退出：Esc 照常关窗，已发出的请求不撤销", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    let finish: (() => void) | undefined;
    vi.mocked(api.createBatch).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () =>
            resolve({
              id: "s4",
              seq: 4,
              name: "新策略",
              description: "",
              active: true,
              created_at: "",
              product_count: 0,
            });
        }),
    );
    render(renderDialog({ onClose }));
    await user.type(screen.getByRole("textbox", { name: "策略名" }), "新策略");
    await user.click(screen.getByRole("button", { name: "创建策略" }));
    await waitFor(() => expect(api.createBatch).toHaveBeenCalledOnce());

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledOnce();
    // 关掉的是界面：请求仍在飞，落定后仍通知一次（不撤销）。
    finish?.();
    await waitFor(() => expect(api.createBatch).toHaveBeenCalledTimes(1));
  });
});
