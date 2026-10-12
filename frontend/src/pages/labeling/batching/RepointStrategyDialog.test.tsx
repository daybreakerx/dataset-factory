import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ApiError, api } from "../../../api";
import { RepointStrategyDialog } from "./RepointStrategyDialog";

vi.mock("../../../api", async (original) => ({
  ...(await original<typeof import("../../../api")>()),
  api: {
    listEndpoints: vi.fn(),
    listPrompts: vi.fn(),
    listSkills: vi.fn(),
    rebindStrategy: vi.fn(),
  },
}));

/** 端点坏了、提示词与一枚 Skill 健康的策略（稿样图格 1 的同形）。 */
const BROKEN = {
  id: "lib2",
  name: "实验·极简",
  description: "",
  endpoint_id: "e-gone",
  prompt_id: "p-caption-01",
  skill_ids: ["sk-1", "sk-gone"],
  endpoint_name: "gone",
  prompt_name: "caption",
  skill_names: ["风格约束", "详细描述"],
  body_chars: 100,
  available: false,
  missing_refs: ["端点配置「gone」不存在", "Skill「详细描述」不存在"],
  damaged: false,
  created_at: "",
  updated_at: "",
};

beforeEach(() => {
  vi.resetAllMocks();
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
  vi.mocked(api.listPrompts).mockResolvedValue([
    { id: "p-caption-01", name: "caption", description: "", body_chars: 0 },
  ]);
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
  ]);
  vi.mocked(api.rebindStrategy).mockResolvedValue({ ...BROKEN, available: true });
});

function renderDialog(onRepointed: () => void = vi.fn()) {
  return {
    onRepointed,
    ...render(
      <RepointStrategyDialog
        strategy={BROKEN}
        onClose={vi.fn()}
        onRepointed={onRepointed}
      />,
    ),
  };
}

it("初值按稿：健康位预选、坏位空占位、缺失 Skill 列灰项、确认钮先禁用", async () => {
  renderDialog();

  // 标题带策略名；缺失说明行逐条列（后端 missing_refs 现查）。
  expect(screen.getByText("重新指定「实验·极简」")).toBeInTheDocument();
  expect(screen.getByText(/端点配置「gone」不存在/)).toBeInTheDocument();
  expect(screen.getByText(/Skill「详细描述」不存在/)).toBeInTheDocument();
  // 端点坏 → 占位「选择端点」；提示词健康 → 预选现值；Skill 健康那枚勾上。
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "端点" })).toHaveTextContent("选择端点"),
  );
  expect(screen.getByRole("button", { name: "提示词" })).toHaveTextContent("caption");
  expect(screen.getByRole("button", { name: "Skill" })).toHaveTextContent("风格约束");
  // 必填位没齐 → 确认钮禁用。
  expect(screen.getByRole("button", { name: "重新指定" })).toBeDisabled();
});

it("选齐现存资产后提交 rebind（只动引用位），成功后回报父层", async () => {
  const user = userEvent.setup();
  const { onRepointed } = renderDialog();

  await user.click(screen.getByRole("button", { name: "端点" }));
  await user.click(await screen.findByRole("menuitem", { name: /model/ }));

  const confirm = screen.getByRole("button", { name: "重新指定" });
  await waitFor(() => expect(confirm).toBeEnabled());
  await user.click(confirm);

  await waitFor(() => expect(onRepointed).toHaveBeenCalledOnce());
  expect(api.rebindStrategy).toHaveBeenCalledExactlyOnceWith("lib2", {
    endpoint_id: "e-model-x1111",
    prompt_id: "p-caption-01",
    skill_ids: ["sk-1"],
  });
});

it("Skill 组里缺失项列名带后缀且不可勾", async () => {
  const user = userEvent.setup();
  renderDialog();

  await user.click(screen.getByRole("button", { name: "Skill" }));

  const missing = await screen.findByRole("menuitemcheckbox", {
    name: /详细描述（缺失或停用）/,
  });
  expect(missing).toHaveAttribute("aria-disabled", "true");
});

it("提交失败落标题行右侧红字槽（A″），不关弹窗可原地重试", async () => {
  const user = userEvent.setup();
  vi.mocked(api.rebindStrategy).mockRejectedValueOnce(
    new ApiError("http", "引用的资产不存在：端点配置「model」不存在。", 400, null),
  );
  renderDialog();

  await user.click(screen.getByRole("button", { name: "端点" }));
  await user.click(await screen.findByRole("menuitem", { name: /model/ }));
  await user.click(screen.getByRole("button", { name: "重新指定" }));

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("引用的资产不存在：端点配置「model」不存在。");
  // 弹窗还在（不关）、确认钮恢复可点。
  expect(screen.getByText("重新指定「实验·极简」")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "重新指定" })).toBeEnabled();
});
