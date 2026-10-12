import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ApiError, api } from "../../../api";
import type { components } from "../../../api-types.gen";
import { getToastSnapshot, removeToast } from "../../../lib/toast";
import { SnapshotDialog } from "./SnapshotDialog";

vi.mock("../../../api", async (original) => ({
  ...(await original<typeof import("../../../api")>()),
  api: { getBatchSnapshot: vi.fn() },
}));

/** 64 位哈希的样子（界面按「前 4…后 4」呈现，笔⑲）。 */
const PROMPT_HASH = `${"3f9ac1d0".padEnd(60, "0")}ff00`;
const SKILL_MD_HASH = `${"b71e40aa".padEnd(60, "0")}4400`;
const REFERENCE_HASH = `${"6c2d9f10".padEnd(60, "0")}9f9f`;

const snapshot: components["schemas"]["BatchSnapshotView"] = {
  endpoint: {
    id: "e-main",
    name: "main",
    base_url: "https://api.example.com/v1",
    model: "test-model",
    api_format: "chat_completions",
    request_params: { temperature: 0.7 },
    sha256: "endpoint-sha",
  },
  prompt: { name: "描述", body: "应用时的提示词正文", sha256: PROMPT_HASH },
  skills: [
    {
      name: "caption",
      files: [
        { path: "SKILL.md", body: "应用时的技能正文", sha256: SKILL_MD_HASH },
        {
          path: "references/style.md",
          body: "应用时的参照正文",
          sha256: REFERENCE_HASH,
        },
      ],
    },
  ],
  built_at: "2026-09-17T00:00:00Z",
  tool_version: "0.1.0",
  sha256: "current-hash",
  recorded_sha256: "current-hash",
  changed: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getBatchSnapshot).mockResolvedValue(snapshot);
  for (const item of getToastSnapshot()) removeToast(item.id);
});

it("默认落配置视图：段数＝配置＋提示词＋每枚 Skill，api_format 与 base_url 平铺进行", async () => {
  render(<SnapshotDialog wid="work" batch="s1" onClose={() => {}} />);

  await screen.findByRole("tablist", { name: "快照内容" });
  expect(screen.getAllByRole("tab")).toHaveLength(3);
  expect(screen.getByRole("tab", { name: "main" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByText("端点地址 base_url")).toBeInTheDocument();
  expect(screen.getByText("https://api.example.com/v1")).toBeInTheDocument();
  expect(screen.getByText("接口格式 api_format")).toBeInTheDocument();
  expect(screen.getByText("0.7")).toBeInTheDocument();
});

it("切到提示词段：视图头行给段名与短哈希，正文块不再是折叠区也不再限高", async () => {
  const user = userEvent.setup();
  render(<SnapshotDialog wid="work" batch="s1" onClose={() => {}} />);

  await user.click(await screen.findByRole("tab", { name: "描述" }));

  expect(await screen.findByText("应用时的提示词正文")).toBeInTheDocument();
  const viewHead = screen.getByText("基础提示词").closest("p");
  if (viewHead === null) throw new Error("视图头行缺失");
  expect(
    within(viewHead).getByText(
      `sha256 ${PROMPT_HASH.slice(0, 4)}…${PROMPT_HASH.slice(-4)}`,
    ),
  ).toBeInTheDocument();
});

it("Skill 视图给文件胶囊条：默认选 SKILL.md，点胶囊换正文与该文件哈希", async () => {
  const user = userEvent.setup();
  render(<SnapshotDialog wid="work" batch="s1" onClose={() => {}} />);

  await user.click(await screen.findByRole("tab", { name: "caption" }));

  expect(await screen.findByText("应用时的技能正文")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "SKILL.md" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByRole("button", { name: "references/style.md" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  await user.click(screen.getByRole("button", { name: "references/style.md" }));

  expect(screen.getByText("应用时的参照正文")).toBeInTheDocument();
  expect(
    screen.getByText(
      `sha256 ${REFERENCE_HASH.slice(0, 4)}…${REFERENCE_HASH.slice(-4)}`,
    ),
  ).toBeInTheDocument();
});

it("快照被手改：警告落标题行右侧、文案是精简句、不再当 alert 播报", async () => {
  vi.mocked(api.getBatchSnapshot).mockResolvedValue({
    ...snapshot,
    changed: true,
    recorded_sha256: "old-hash",
  });
  render(<SnapshotDialog wid="work" batch="s1" onClose={() => {}} />);

  const warn = await screen.findByText("快照可能被手动修改，后续跑批将使用当前快照。");
  expect(warn.closest("div")).toBe(screen.getByText("策略快照").closest("div"));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("读取中只出内容区一行等待，分段控件整段不出", async () => {
  vi.mocked(api.getBatchSnapshot).mockImplementation(() => new Promise(() => {}));
  render(<SnapshotDialog wid="work" batch="s1" onClose={() => {}} />);

  expect(await screen.findByRole("status")).toHaveTextContent("正在读取快照");
  expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "复制快照" })).toBeDisabled();
});

it("读取失败就地给后端真话并可重新读取，失败态同样不出分段控件", async () => {
  const user = userEvent.setup();
  vi.mocked(api.getBatchSnapshot).mockRejectedValueOnce(
    new ApiError("http", "快照文件不存在或已被清理", 404, null),
  );
  render(<SnapshotDialog wid="work" batch="s1" onClose={() => {}} />);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "快照文件不存在或已被清理",
  );
  expect(screen.queryByRole("tablist")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "重新读取" }));

  expect(await screen.findByRole("tablist")).toBeInTheDocument();
  expect(screen.getByText("test-model")).toBeInTheDocument();
  expect(api.getBatchSnapshot).toHaveBeenCalledTimes(2);
  expect(api.getBatchSnapshot).toHaveBeenLastCalledWith("work", "s1");
});

it("环境类失败走浮层不占界面：内容区不出错误行，提示进 toast", async () => {
  vi.mocked(api.getBatchSnapshot).mockRejectedValue(
    new ApiError("network", "连不上后端，请检查服务是否在跑", null, null),
  );
  render(<SnapshotDialog wid="work" batch="s1" onClose={() => {}} />);

  await waitFor(() =>
    expect(getToastSnapshot().map((item) => item.text)).toContain(
      "连不上后端，请检查服务是否在跑",
    ),
  );
  expect(screen.queryByText("连不上后端，请检查服务是否在跑")).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("复制反馈＝钮本体换装并 1.5 秒复位，元信息落页脚左位", async () => {
  const user = userEvent.setup();
  const clipboard = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  render(<SnapshotDialog wid="work" batch="s1" onClose={() => {}} />);
  await screen.findByRole("tablist");
  const meta = screen.getByText(
    (content, element) =>
      element?.tagName === "SPAN" && content.startsWith("快照时间 "),
  );
  expect(meta).toHaveTextContent("工具版本 0.1.0");
  expect(meta).toHaveTextContent("快照哈希 current-hash");

  await user.click(screen.getByRole("button", { name: "复制快照" }));

  expect(clipboard).toHaveBeenCalledWith(JSON.stringify(snapshot, null, 2));
  expect(screen.getByRole("button", { name: "已复制" })).toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  await new Promise((resolve) => {
    setTimeout(resolve, 1_600);
  });
  expect(screen.getByRole("button", { name: "复制快照" })).toBeInTheDocument();
});

it("切换批次后丢弃旧快照迟到结果", async () => {
  let finish: ((value: typeof snapshot) => void) | undefined;
  vi.mocked(api.getBatchSnapshot).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { rerender } = render(
    <SnapshotDialog wid="work" batch="s1" onClose={() => {}} />,
  );
  rerender(<SnapshotDialog wid="work" batch="s2" onClose={() => {}} />);
  expect(await screen.findByText("test-model")).toBeInTheDocument();
  await act(async () => {
    finish?.({ ...snapshot, endpoint: { ...snapshot.endpoint, model: "旧批次模型" } });
  });
  expect(screen.queryByText("旧批次模型")).not.toBeInTheDocument();
});
