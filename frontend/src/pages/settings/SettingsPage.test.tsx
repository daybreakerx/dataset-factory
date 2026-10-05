import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EndpointConfigSummary, SkillInfo } from "../../api";
import { SettingsPage } from "./SettingsPage";
import { parseLogLevel } from "./service/ServicePanel";

// 设置页测试只关心「交互 → 调了哪个 API → 界面状态对不对」，api 层整体 mock 掉。
// 注意查询唯一性：选中的名称同时出现在列表行与详情标题里，断言一律用 label / 唯一文本。
const apiMock = vi.hoisted(() => ({
  listEndpoints: vi.fn(),
  createEndpoint: vi.fn(),
  updateEndpoint: vi.fn(),
  deleteEndpoint: vi.fn(),
  testEndpoint: vi.fn(),
  listSkills: vi.fn(),
  importSkill: vi.fn(),
  importSkillFiles: vi.fn(),
  importSkillFile: vi.fn(),
  setSkillEnabled: vi.fn(),
  renameSkill: vi.fn(),
  deleteSkill: vi.fn(),
  listSkillFiles: vi.fn(),
  readSkillFile: vi.fn(),
  saveSkillFile: vi.fn(),
  listDirectory: vi.fn(),
  getService: vi.fn(),
  getServiceLogs: vi.fn(),
}));

// 部分 mock：只替掉 api 对象，ApiError / errorMessage 用真货——错误分档要靠真类的 kind 字段判。
vi.mock("../../api", async (original) => ({
  ...(await original<typeof import("../../api")>()),
  api: apiMock,
}));

const ENDPOINTS: EndpointConfigSummary[] = [
  {
    id: "e-default-x1",
    name: "default",
    base_url: "https://a/v1",
    model: "model-a",
    api_format: "openai-chat-completions",
    has_api_key: true,
    request_params: {},
  },
  {
    id: "e-backup-x1",
    name: "backup",
    base_url: "https://b/v1",
    model: "model-b",
    api_format: "openai-chat-completions",
    has_api_key: false,
    request_params: {},
  },
];

const SKILLS: SkillInfo[] = [
  {
    id: "k-h3-skill-01",
    name: "h3-skill",
    description: "H3 官方要求",
    enabled: true,
    body_chars: 1240,
    damage_kind: null,
    damage_file: "",
  },
  {
    id: "k-old-skill-01",
    name: "old-skill",
    description: "",
    enabled: false,
    body_chars: 320,
    damage_kind: null,
    damage_file: "",
  },
];

const SKILL_FILES = {
  name: "h3-skill",
  files: [
    { path: "SKILL.md", role: "skill", previewable: true },
    { path: "references/detail.md", role: "reference", previewable: true },
    { path: "assets/cover.png", role: "asset", previewable: false },
  ],
};

/** SKILL.md 的正文（读写两侧共用一份，断言里不必再抄一遍带转义的字符串）。 */
const SKILL_MD = "# Example\n按格式输出 caption。";

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.listEndpoints.mockResolvedValue(ENDPOINTS);
  apiMock.listSkills.mockResolvedValue(SKILLS);
  apiMock.listSkillFiles.mockResolvedValue(SKILL_FILES);
  apiMock.readSkillFile.mockResolvedValue({ path: "SKILL.md", content: SKILL_MD });
  apiMock.getService.mockResolvedValue({
    version: "0.1.0",
    host: "127.0.0.1",
    port: 8000,
    started_at: new Date(Date.now() - 134 * 60_000).toISOString(),
    log_file: "",
  });
  apiMock.getServiceLogs.mockResolvedValue({
    path: "run.log",
    exists: true,
    content: "",
  });
});

describe("SettingsPage · 连接·端点配置", () => {
  it("技能开关等待响应时禁用重复提交，失败后恢复操作", async () => {
    let rejectToggle: (error: Error) => void = () => {};
    apiMock.setSkillEnabled.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectToggle = reject;
        }),
    );
    render(<SettingsPage section="skills" />);
    const toggle = await screen.findByLabelText("启用 h3-skill");

    await userEvent.click(toggle);
    await userEvent.click(toggle);
    expect(toggle).toBeDisabled();
    expect(apiMock.setSkillEnabled).toHaveBeenCalledTimes(1);
    rejectToggle(new Error("写入失败"));

    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(await screen.findByText(/写入失败/)).toBeVisible();
  });

  it("列表 + 详情回填：名称可编辑、密钥只报来源不回内容", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByLabelText("Base URL")).toHaveValue("https://a/v1");
    });
    expect(screen.getByText("backup")).toBeInTheDocument();
    expect(screen.getByLabelText("配置名称")).toHaveValue("default");
    expect(screen.getByLabelText("配置名称")).toBeEnabled();
    expect(screen.getByLabelText("模型名称")).toHaveValue("model-a");
    // 「这套配没配密钥」只由密钥框占位表达（状态行与锁图标安全行整撤）。
    expect(screen.getByLabelText("API 密钥")).toHaveAttribute(
      "placeholder",
      "留空即沿用已配置密钥",
    );
  });

  it("同名配置按 ID 寻址：两套同显示名都能分别选中并保存到各自的 id", async () => {
    const first: EndpointConfigSummary = {
      id: "e-dup-a",
      name: "同名",
      base_url: "https://a/v1",
      model: "model-a",
      api_format: "openai-chat-completions",
      has_api_key: true,
      request_params: {},
    };
    const second: EndpointConfigSummary = {
      id: "e-dup-b",
      name: "同名",
      base_url: "https://b/v1",
      model: "model-b",
      api_format: "openai-chat-completions",
      has_api_key: false,
      request_params: {},
    };
    apiMock.listEndpoints.mockResolvedValue([first, second]);
    apiMock.updateEndpoint.mockResolvedValue(second);
    render(<SettingsPage />);

    await waitFor(() => screen.getAllByText("同名"));
    // 显示名可重名：两行同名并存，第二行选中后保存落到第二套的 id（而非按名 404）。
    const rows = screen.getAllByRole("button", { name: "同名" });
    expect(rows).toHaveLength(2);
    await userEvent.click(rows[1] as HTMLElement);
    await waitFor(() =>
      expect(screen.getByLabelText("Base URL")).toHaveValue("https://b/v1"),
    );
    await userEvent.clear(screen.getByLabelText("模型名称"));
    await userEvent.type(screen.getByLabelText("模型名称"), "model-b2");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(apiMock.updateEndpoint).toHaveBeenCalledWith(
        "e-dup-b",
        expect.objectContaining({ model: "model-b2" }),
      );
    });
  });

  it("列表三态：空库显示「未配置模型」（不拿取数中顶空态）", async () => {
    apiMock.listEndpoints.mockResolvedValue([]);
    render(<SettingsPage />);

    expect(await screen.findByText("未配置模型")).toBeInTheDocument();
  });

  it("列表三态：取数失败显示固定失败句，后端原文不进界面", async () => {
    apiMock.listEndpoints.mockRejectedValue(new Error("boom 业务错误"));
    render(<SettingsPage />);

    expect(await screen.findByText("配置读取失败")).toBeInTheDocument();
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
  });

  it("密钥框内嵌尾随钮：有输入才出现，点击切明文与 aria 随态", async () => {
    render(<SettingsPage />);

    await waitFor(() => screen.getByLabelText("Base URL"));
    const key = screen.getByLabelText("API 密钥");
    // 空框不出钮——避免误读成「点它能查回已存密钥」。
    expect(screen.queryByRole("button", { name: "显示密钥" })).not.toBeInTheDocument();

    await userEvent.type(key, "sk-x");
    expect(screen.getByRole("button", { name: "显示密钥" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "显示密钥" }));
    expect(key).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "隐藏密钥" })).toBeInTheDocument();
  });

  it("保存更改：不带密钥调 updateEndpoint（后端沿用已存密钥）", async () => {
    apiMock.updateEndpoint.mockResolvedValue(ENDPOINTS[0]);
    render(<SettingsPage />);

    await waitFor(() => screen.getByLabelText("Base URL"));
    await userEvent.clear(screen.getByLabelText("模型名称"));
    await userEvent.type(screen.getByLabelText("模型名称"), "model-a2");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(apiMock.updateEndpoint).toHaveBeenCalledWith("e-default-x1", {
        base_url: "https://a/v1",
        model: "model-a2",
        api_format: "openai-chat-completions",
        request_params: {},
      });
    });
    expect(await screen.findByText("已保存「default」的更改")).toBeInTheDocument();
  });

  it("改名保存：带 new_name 调 updateEndpoint，反馈与详情切到新名", async () => {
    const renamed: EndpointConfigSummary = {
      id: "e-renamed-x1",
      name: "renamed",
      base_url: "https://a/v1",
      model: "model-a",
      api_format: "openai-chat-completions",
      has_api_key: true,
      request_params: {},
    };
    // 改名后 reload 拿到含新名的列表，详情区保持在新配置上（同「添加配置」的两次 mock 口径）。
    apiMock.listEndpoints
      .mockResolvedValueOnce(ENDPOINTS)
      .mockResolvedValue([ENDPOINTS[1], renamed]);
    apiMock.updateEndpoint.mockResolvedValue(renamed);
    render(<SettingsPage />);

    await waitFor(() => screen.getByLabelText("Base URL"));
    await userEvent.clear(screen.getByLabelText("配置名称"));
    await userEvent.type(screen.getByLabelText("配置名称"), "renamed");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(apiMock.updateEndpoint).toHaveBeenCalledWith("e-default-x1", {
        base_url: "https://a/v1",
        model: "model-a",
        api_format: "openai-chat-completions",
        request_params: {},
        new_name: "renamed",
      });
    });
    expect(
      await screen.findByText("已改名并保存：「default」→「renamed」"),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText("配置名称")).toHaveValue("renamed");
  });

  it("添加配置：创建后给出成功反馈", async () => {
    const created: EndpointConfigSummary = {
      id: "e-new-one-x1",
      name: "new-one",
      base_url: "https://n/v1",
      model: "m",
      api_format: "openai-chat-completions",
      has_api_key: true,
      request_params: {},
    };
    // 真实后端在创建后会把它返回进列表；mock 同样按两次调用给不同结果，
    // 否则创建后 reload 拿到不含新配置的列表，详情区退回占位、反馈条被卸载。
    apiMock.listEndpoints
      .mockResolvedValueOnce(ENDPOINTS)
      .mockResolvedValue([...ENDPOINTS, created]);
    apiMock.createEndpoint.mockResolvedValue(created);
    render(<SettingsPage />);

    await waitFor(() => screen.getByLabelText("Base URL"));
    await userEvent.click(screen.getByRole("button", { name: "添加配置" }));
    await userEvent.type(screen.getByLabelText("配置名称"), "new-one");
    await userEvent.type(screen.getByLabelText("Base URL"), "https://n/v1");
    await userEvent.type(screen.getByLabelText("模型名称"), "m");
    await userEvent.type(screen.getByLabelText("API 密钥"), "sk-new-key"); // pragma: allowlist secret —— 测试假密钥
    await userEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => {
      expect(apiMock.createEndpoint).toHaveBeenCalledWith({
        name: "new-one",
        base_url: "https://n/v1",
        model: "m",
        api_format: "openai-chat-completions",
        request_params: {},
        api_key: "sk-new-key", // pragma: allowlist secret —— 测试假密钥
      });
    });
    expect(await screen.findByText("已创建配置「new-one」")).toBeInTheDocument();
  });

  it("删除：确认对话框内的删除钮才真正调 deleteEndpoint", async () => {
    apiMock.deleteEndpoint.mockResolvedValue(undefined);
    render(<SettingsPage />);

    await waitFor(() => screen.getByLabelText("Base URL"));
    await userEvent.click(screen.getByRole("button", { name: "删除配置" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "删除" }));

    await waitFor(() => {
      expect(apiMock.deleteEndpoint).toHaveBeenCalledWith("e-default-x1");
    });
  });
});

describe("SettingsPage · 端点配置·测试连接", () => {
  it("测试连接：调 testEndpoint 并显示结果与耗时", async () => {
    apiMock.testEndpoint.mockResolvedValue({
      ok: true,
      message: "连接成功，模型应答正常。",
      latency_ms: 412,
    });
    render(<SettingsPage />);
    await screen.findByText("default");

    await userEvent.click(screen.getByRole("button", { name: "测试连接" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "连接成功，模型应答正常。 · 412 ms",
      );
    });
    expect(apiMock.testEndpoint).toHaveBeenCalledWith({
      base_url: "https://a/v1",
      model: "model-a",
      api_format: "openai-chat-completions",
      id: "e-default-x1",
    });
  });

  it("测试连接失败：显示后端分类提示", async () => {
    apiMock.testEndpoint.mockResolvedValue({
      ok: false,
      message: "鉴权失败：API 密钥无效或过期。",
      latency_ms: 120,
    });
    render(<SettingsPage />);
    await screen.findByText("default");

    await userEvent.click(screen.getByRole("button", { name: "测试连接" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("鉴权失败");
    });
  });
});

describe("SettingsPage · 端点配置·高级参数", () => {
  const TUNED: EndpointConfigSummary = {
    id: "e-tuned-x111",
    name: "tuned",
    base_url: "https://t/v1",
    model: "model-t",
    api_format: "openai-chat-completions",
    has_api_key: true,
    request_params: {
      temperature: 0.7,
      extra_body: { top_k: 50 },
    },
  };

  async function openAdvanced(): Promise<void> {
    apiMock.listEndpoints.mockResolvedValue([TUNED]);
    render(<SettingsPage />);
    await waitFor(() => screen.getByLabelText("Base URL"));
    await userEvent.click(screen.getByRole("button", { name: /高级参数（可选）/ }));
  }

  it("默认折叠；展开后模型通用参数（表单 + JSON）与传输参数两组齐备", async () => {
    render(<SettingsPage />);
    await waitFor(() => screen.getByLabelText("Base URL"));
    expect(screen.queryByLabelText("temperature")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /高级参数（可选）/ }));

    expect(screen.getByLabelText("temperature")).toBeInTheDocument();
    expect(screen.getByLabelText("top_p")).toBeInTheDocument();
    expect(screen.getByLabelText("max_tokens")).toBeInTheDocument();
    expect(screen.getByLabelText("模型通用参数 JSON")).toBeInTheDocument();
    expect(screen.getByLabelText(/timeout_seconds/)).toBeInTheDocument();
    expect(screen.getByLabelText(/max_retries/)).toBeInTheDocument();
  });

  it("落盘参数回填：表单与 JSON 一致显示（extra_body 在 JSON 里）", async () => {
    await openAdvanced();

    expect(screen.getByLabelText("temperature")).toHaveValue(0.7);
    expect(screen.getByLabelText("top_p")).toHaveValue(null);
    expect(screen.getByLabelText("模型通用参数 JSON")).toHaveValue(
      JSON.stringify({ temperature: 0.7, extra_body: { top_k: 50 } }, null, 2),
    );
  });

  it("粘贴厂商风格 JSON：已知键同步进表单，未知键提示已忽略（不报错）", async () => {
    await openAdvanced();
    const json = screen.getByLabelText("模型通用参数 JSON");

    // JSON 含 {} 字符（userEvent.type 会误当按键语法）；组件走 onInput，用 fireEvent.input。
    fireEvent.input(json, { target: { value: '{"temperature":0.2,"top_k":40}' } });

    expect(screen.getByLabelText("temperature")).toHaveValue(0.2);
    expect(screen.getByRole("status")).toHaveTextContent("已忽略：top_k");
  });

  it("JSON 无效时保存被拦下（不发请求），提示修好再保存", async () => {
    await openAdvanced();
    const json = screen.getByLabelText("模型通用参数 JSON");

    fireEvent.input(json, { target: { value: "{oops" } });
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(apiMock.updateEndpoint).not.toHaveBeenCalled();
    expect(await screen.findByText(/JSON 写法无效/)).toBeInTheDocument();
  });

  it("旧后端响应缺 request_params 字段时详情页不崩（热升级窗口防御）", async () => {
    // 模拟「旧后端进程 + 新页面」的热升级窗口：响应没有 request_params 键
    // （新契约里必填；实机白屏事故 2026-09-13 的根因）。缺字段按未设置处理。
    const legacy = { ...TUNED } as Record<string, unknown>;
    delete legacy.request_params;
    apiMock.listEndpoints.mockResolvedValue([
      legacy as unknown as EndpointConfigSummary,
    ]);
    render(<SettingsPage />);
    await waitFor(() => screen.getByLabelText("Base URL"));

    expect(screen.getByLabelText("Base URL")).toHaveValue("https://t/v1");
    await userEvent.click(screen.getByRole("button", { name: /高级参数（可选）/ }));
    expect(screen.getByLabelText("temperature")).toHaveValue(null);
    // 无参数 = 空串展示（占位符给 JSON 示例，2026-09-13 用户反馈）。
    expect(screen.getByLabelText("模型通用参数 JSON")).toHaveValue("");
    expect(screen.getByLabelText("模型通用参数 JSON")).toHaveAttribute(
      "placeholder",
      expect.stringContaining('"extra_body"'),
    );
  });

  it("保存携带高级参数：表单值 + JSON 里的 extra_body 一起进载荷", async () => {
    apiMock.updateEndpoint.mockResolvedValue(TUNED);
    await openAdvanced();

    await userEvent.clear(screen.getByLabelText("temperature"));
    await userEvent.type(screen.getByLabelText("temperature"), "0.8");
    await userEvent.type(screen.getByLabelText(/timeout_seconds/), "240");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(apiMock.updateEndpoint).toHaveBeenCalledWith("e-tuned-x111", {
        base_url: "https://t/v1",
        model: "model-t",
        api_format: "openai-chat-completions",
        request_params: {
          temperature: 0.8,
          extra_body: { top_k: 50 },
          timeout_seconds: 240,
        },
      });
    });
  });
});

describe("SettingsPage · 能力·技能", () => {
  async function openSkills(): Promise<void> {
    render(<SettingsPage section="skills" />);
    await waitFor(() => screen.getByLabelText("启用 h3-skill"));
  }

  it("列表三态：空库显示「Skill 库为空」；取数失败显示固定失败句", async () => {
    apiMock.listSkills.mockResolvedValue([]);
    render(<SettingsPage section="skills" />);
    expect(await screen.findByText("Skill 库为空")).toBeInTheDocument();

    apiMock.listSkills.mockRejectedValue(new Error("boom 业务错误"));
    render(<SettingsPage section="skills" />);
    expect(await screen.findByText("技能读取失败")).toBeInTheDocument();
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
  });

  it("列表行：状态开关 + 状态徽章；点开关调 setSkillEnabled（停用 ≠ 删除）", async () => {
    await openSkills();

    expect(screen.getAllByText("已启用").length).toBeGreaterThan(0);
    expect(screen.getAllByText("已停用").length).toBeGreaterThan(0);

    await userEvent.click(screen.getByLabelText("启用 h3-skill"));

    await waitFor(() => {
      expect(apiMock.setSkillEnabled).toHaveBeenCalledWith("k-h3-skill-01", false);
    });
  });

  it("列表卡片：名称旁显示注入字数徽标（注入正文字符数）", async () => {
    await openSkills();

    expect(screen.getByText("1.2k 字")).toBeInTheDocument();
    expect(screen.getByText("0.3k 字")).toBeInTheDocument();
    // 注入量提示走自研气泡（Tip），不再用原生 title；徽标本体仍在名称旁。
    expect(screen.queryByTitle(/注入正文字符数/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/字$/).length).toBe(2);
  });

  it("搜索框按名称过滤列表", async () => {
    await openSkills();

    await userEvent.type(screen.getByLabelText("搜索技能"), "old");

    expect(screen.getByLabelText("启用 old-skill")).toBeInTheDocument();
    expect(screen.queryByLabelText("启用 h3-skill")).not.toBeInTheDocument();
  });

  it("损坏包降级呈现：占位名＋警告图标进列表，原因与目录名走图标 Tip、行内无描述", async () => {
    apiMock.listSkills.mockResolvedValue([
      {
        id: "k-bad-x111111",
        name: "技能已损坏",
        description:
          "文件损坏：SKILL.md 的 frontmatter 未闭合（开头有 ---，但找不到结束的 ---）。",
        enabled: true,
        body_chars: 0,
        damage_kind: "frontmatter-corrupt",
        damage_file: "SKILL.md",
      },
    ] satisfies SkillInfo[]);
    render(<SettingsPage section="skills" />);
    const row = (await screen.findByLabelText("启用 技能已损坏")).parentElement;

    // 名字位＝占位名（不回落裸目录名 / ID）；行内不再渲染描述（2026-09-30 行撤描述），
    // 损坏原因与「目录名 <ID>」走图标 Tip（jsdom 不悬停，Tip 内容归 E2E 层）。
    expect(within(row as HTMLElement).getByText("技能已损坏")).toBeInTheDocument();
    expect(
      within(row as HTMLElement).queryByText(/文件损坏：/),
    ).not.toBeInTheDocument();
    expect(row?.querySelector("svg.lucide-triangle-alert")).not.toBeNull();
  });

  it("导入成功：选择文件夹调 importSkillFiles 并给出体积与 token 提醒反馈条", async () => {
    apiMock.importSkillFiles.mockResolvedValue({
      id: "kFresh000001",
      name: "fresh",
      description: "",
      enabled: true,
      total_bytes: 42_000,
      damage_kind: null,
      import_error: null,
      transcoded: [],
    });
    await openSkills();

    await userEvent.click(screen.getByRole("button", { name: "导入 Skill" }));
    const input = screen.getByLabelText("选择 skill 文件夹");
    const folderFile = new File(["# U"], "SKILL.md", { type: "text/markdown" });
    Object.defineProperty(folderFile, "webkitRelativePath", {
      value: "fresh/SKILL.md",
    });
    fireEvent.change(input as HTMLInputElement, { target: { files: [folderFile] } });

    await waitFor(() => {
      expect(apiMock.importSkillFiles).toHaveBeenCalledTimes(1);
    });
    expect(
      await screen.findByText(/41\.0 KiB——skill 全文将注入打标请求/),
    ).toBeInTheDocument();
  });

  it("服务器选择器确认后回填技能文件，点击导入才提交", async () => {
    apiMock.listDirectory.mockResolvedValue({
      hostname: "skill-server",
      system: "Linux",
      path: "/srv/skills",
      parent: "/srv",
      unavailable_count: 0,
      entries: [
        {
          name: "notes.txt",
          path: "/srv/skills/notes.txt",
          kind: "file",
          size: 24,
          modified_at: "2026-09-17T00:00:00Z",
        },
      ],
    });
    apiMock.importSkill.mockResolvedValue({
      id: "kNotes000001",
      name: "notes",
      description: "",
      enabled: true,
      total_bytes: 24,
      damage_kind: null,
      import_error: null,
      transcoded: [],
    });
    await openSkills();

    await userEvent.click(screen.getByRole("button", { name: "导入 Skill" }));
    await userEvent.click(screen.getByRole("button", { name: "选择技能目录或文件" }));
    const picker = within(
      await screen.findByRole("dialog", { name: "选择目录或文件" }),
    );
    await userEvent.click(await picker.findByRole("button", { name: "notes.txt" }));
    await userEvent.click(picker.getByRole("button", { name: "选择此文件" }));

    expect(apiMock.listDirectory).toHaveBeenCalledWith("", true, false, [
      ".md",
      ".txt",
    ]);
    expect(screen.getByLabelText("skill 服务器路径")).toHaveValue(
      "/srv/skills/notes.txt",
    );
    expect(apiMock.importSkill).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "导入" }));
    expect(apiMock.importSkill).toHaveBeenCalledWith("/srv/skills/notes.txt");
  });

  it("路径导入：粘贴路径点导入调 importSkill；空路径时导入按钮禁用", async () => {
    apiMock.importSkill.mockResolvedValue({
      id: "kPath0000001",
      name: "path-skill",
      description: "",
      enabled: true,
      total_bytes: 1024,
      damage_kind: null,
      import_error: null,
      transcoded: [],
    });
    await openSkills();

    await userEvent.click(screen.getByRole("button", { name: "导入 Skill" }));
    const importButton = screen.getByRole("button", { name: "导入" });
    expect(importButton).toBeDisabled();

    await userEvent.type(screen.getByLabelText("skill 服务器路径"), "C:/skills/demo");
    expect(importButton).toBeEnabled();
    await userEvent.click(importButton);

    await waitFor(() => {
      expect(apiMock.importSkill).toHaveBeenCalledWith("C:/skills/demo");
    });
    expect(await screen.findByText(/已导入「path-skill」/)).toBeInTheDocument();
  });

  it("单文件导入：SKILL.md 文件入口调 importSkillFile（单文件 skill 无文件夹结构）", async () => {
    apiMock.importSkillFile.mockResolvedValue({
      id: "kSingle00001",
      name: "single",
      description: "",
      enabled: true,
      total_bytes: 2048,
      damage_kind: null,
      import_error: null,
      transcoded: [],
    });
    await openSkills();

    await userEvent.click(screen.getByRole("button", { name: "导入 Skill" }));
    fireEvent.change(screen.getByLabelText("选择 SKILL.md 文件"), {
      target: {
        files: [new File(["# S"], "my-skill.md", { type: "text/markdown" })],
      },
    });

    await waitFor(() => {
      expect(apiMock.importSkillFile).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText(/已导入「single」/)).toBeInTheDocument();
  });

  it("包文件 chips：可预览文件点击加载内容；assets 灰显禁用（不参与注入）", async () => {
    await openSkills();

    // 默认预览注入源 SKILL.md（chip 与预览框标题都可能有它，断言内容文本即可）。
    await waitFor(() => {
      expect(screen.getByText(/按格式输出 caption/)).toBeInTheDocument();
    });
    expect(screen.getByText("references/detail.md")).toBeEnabled();
    expect(screen.getByText("assets/cover.png")).toBeDisabled();

    await userEvent.click(screen.getByText("references/detail.md"));

    await waitFor(() => {
      expect(apiMock.readSkillFile).toHaveBeenCalledWith(
        "k-h3-skill-01",
        "references/detail.md",
      );
    });
  });

  it("技能正文与描述保存携带原始基线，失败后保留草稿并可重试", async () => {
    apiMock.saveSkillFile.mockRejectedValueOnce(new Error("文件已被修改"));
    apiMock.saveSkillFile.mockResolvedValueOnce({
      path: "SKILL.md",
      content: "保存后的正文",
    });
    await openSkills();
    const editor = await screen.findByLabelText("技能文件内容");
    await waitFor(() => expect(editor).toHaveValue("# Example\n按格式输出 caption。"));

    fireEvent.change(editor, { target: { value: "新的正文" } });
    fireEvent.change(screen.getByLabelText("技能描述"), {
      target: { value: "新的描述" },
    });
    expect(screen.getByRole("button", { name: "references/detail.md" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText(/文件已被修改/)).toBeInTheDocument();
    expect(editor).toHaveValue("新的正文");
    expect(apiMock.saveSkillFile).toHaveBeenCalledWith("k-h3-skill-01", "SKILL.md", {
      content: "新的正文",
      original_content: "# Example\n按格式输出 caption。",
      description: "新的描述",
    });
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(editor).toHaveValue("保存后的正文"));
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });

  it("改名称：先按原名存正文、再改名，选中项与列表跟到新名", async () => {
    const renamed: SkillInfo[] = SKILLS.map((item) =>
      item.name === "h3-skill" ? { ...item, name: "h3-caption" } : item,
    );
    apiMock.listSkills.mockResolvedValueOnce(SKILLS).mockResolvedValue(renamed);
    apiMock.renameSkill.mockResolvedValue(undefined);
    apiMock.saveSkillFile.mockResolvedValue({ path: "SKILL.md", content: "新的正文" });
    await openSkills();

    const nameField = await screen.findByLabelText("技能名称");
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    fireEvent.change(nameField, { target: { value: "h3-caption" } });
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    // 改名必须排在存内容之后：改名会重写 frontmatter，先改名就让刚读的基线失效（PUT 400）。
    expect(apiMock.saveSkillFile).toHaveBeenCalledWith("k-h3-skill-01", "SKILL.md", {
      content: SKILL_MD,
      original_content: SKILL_MD,
    });
    await waitFor(() =>
      expect(apiMock.renameSkill).toHaveBeenCalledWith("k-h3-skill-01", {
        new_name: "h3-caption",
      }),
    );
    expect(screen.getByLabelText("技能名称")).toHaveValue("h3-caption");
    expect(screen.getByText("已保存并改名为「h3-caption」")).toBeInTheDocument();
    expect(screen.getByLabelText("启用 h3-caption")).toBeInTheDocument();
  });

  it("改名撞上已有技能：保留输入与草稿，就地给出后端的原因", async () => {
    apiMock.renameSkill.mockRejectedValue(new Error("已有同名 skill：old-skill"));
    await openSkills();

    fireEvent.change(await screen.findByLabelText("技能名称"), {
      target: { value: "old-skill" },
    });
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText(/已有同名 skill/)).toBeInTheDocument();
    expect(screen.getByLabelText("技能名称")).toHaveValue("old-skill");
    expect(screen.getByLabelText("启用 h3-skill")).toBeInTheDocument();
  });

  it("放弃路：dirty 起未保存确认弹窗，放弃修改后内容回退、文件切换解锁", async () => {
    await openSkills();
    const editor = await screen.findByLabelText("技能文件内容");
    await waitFor(() => expect(editor).toHaveValue("# Example\n按格式输出 caption。"));

    fireEvent.change(editor, { target: { value: "未保存" } });
    // 放弃更改钮随操作条撤除：回退唯一入口＝未保存确认弹窗「放弃修改」。
    await userEvent.click(screen.getByRole("button", { name: /old-skill/ }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "放弃修改" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(editor).toHaveValue("# Example\n按格式输出 caption。");
    expect(screen.getByRole("button", { name: "references/detail.md" })).toBeEnabled();
  });

  it("dirty 时点其他技能行：起未保存确认弹窗，放弃修改后完成切换", async () => {
    await openSkills();
    // 弄脏详情（改描述），再点另一行——dirty 语义改写：动作照常可点、由弹窗兜底。
    fireEvent.change(await screen.findByLabelText("技能描述"), {
      target: { value: "新的描述" },
    });
    await userEvent.click(screen.getByRole("button", { name: /old-skill/ }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("当前有未保存编辑，是否保存。"),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "放弃修改" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // 切换完成：详情已落到另一技能（放弃的描述草稿随切换消失）。
    await waitFor(() =>
      expect(screen.getByLabelText("技能名称")).toHaveValue("old-skill"),
    );
  });

  it("拖入单文件通过导入接口提交一次并显示结果", async () => {
    apiMock.importSkillFile.mockResolvedValue({
      id: "kDropped001",
      name: "dropped",
      description: "",
      enabled: true,
      total_bytes: 12,
      damage_kind: null,
      import_error: null,
      transcoded: [],
    });
    await openSkills();
    await userEvent.click(screen.getByRole("button", { name: "导入 Skill" }));
    const file = new File(["skill"], "SKILL.md");

    fireEvent.drop(screen.getByRole("button", { name: "拖入 Skill 包" }), {
      dataTransfer: { items: [], files: [file] },
    });

    await waitFor(() =>
      expect(apiMock.importSkillFile).toHaveBeenCalledExactlyOnceWith(file),
    );
    expect(await screen.findByText(/已导入「dropped」/)).toBeInTheDocument();
  });
});

describe("SettingsPage · 服务·运行日志", () => {
  it("改名与头行：页题「运行日志」、状态行＋监听信息＋筛选＋图标刷新钮；无关机钮", async () => {
    render(<SettingsPage section="service" />);

    expect(screen.getByText("运行日志")).toBeInTheDocument();
    expect(await screen.findByText("服务运行中")).toBeInTheDocument();
    expect(
      screen.getByText(/监听 127\.0\.0\.1:8000 · 已运行 2 小时 14 分/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("日志级别")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新" })).toBeInTheDocument();
    // 本页无关机钮（2026-10-05 用户裁）：关机入口只剩侧栏底部钮组图标钮。
    expect(screen.queryByRole("button", { name: "关闭服务" })).not.toBeInTheDocument();
  });

  it("日志区：倒序显示最新在顶（文件序正序反转）", async () => {
    apiMock.getServiceLogs.mockResolvedValue({
      path: "run.log",
      exists: true,
      content:
        "2026-10-05 04:00:00,000 INFO [-] a: 第一行\n2026-10-05 04:01:00,000 WARNING [-] b: 警告行\n2026-10-05 04:02:00,000 ERROR [-] c: 报错行",
    });
    render(<SettingsPage section="service" />);

    const errorLine = await screen.findByText(/报错行/);
    const box = errorLine.closest("div") as HTMLElement;
    const text = box.textContent ?? "";
    expect(text.indexOf("报错行")).toBeLessThan(text.indexOf("警告行"));
    expect(text.indexOf("警告行")).toBeLessThan(text.indexOf("第一行"));
  });

  it("级别解析：WARNING→警告档、ERROR/CRITICAL→报错档、INFO→信息档", async () => {
    expect(parseLogLevel("2026-10-05 04:01:00,000 WARNING [-] b: 警告")).toBe("warn");
    expect(parseLogLevel("2026-10-05 04:02:00,000 ERROR [-] c: 报错")).toBe("bad");
    expect(parseLogLevel("2026-10-05 04:02:00,000 CRITICAL [-] c: 致命")).toBe("bad");
    expect(parseLogLevel("2026-10-05 04:00:00,000 INFO [-] a: 信息")).toBe("info");
  });
});
