import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";

import type { ApiStubTable } from "../../../.storybook/preview";
import { SettingsPage } from "./SettingsPage";

/**
 * SettingsPage 的样例 stories（端点配置与技能两个设置子页、四个状态）。
 * section 经 props 摆拍；各面板挂载即取列表——数据面按桩表回放。
 */
const meta = {
  title: "Pages/SettingsPage",
  component: SettingsPage,
} satisfies Meta<typeof SettingsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

const ENDPOINTS_STUBS = {
  "GET /api/endpoints": [
    {
      id: "e-1",
      name: "default",
      base_url: "https://api.example.test/v1",
      model: "example-caption-model",
      api_format: "openai-chat",
      has_api_key: true,
      request_params: {},
    },
    {
      id: "e-2",
      name: "offline",
      base_url: "http://127.0.0.1:9/v1",
      model: "offline-model",
      api_format: "openai-chat",
      has_api_key: false,
      request_params: {},
    },
  ],
} satisfies ApiStubTable as ApiStubTable;

const SKILLS_STUBS = {
  "GET /api/skills": [
    {
      id: "k-1",
      name: "caption-style",
      description: "风格约束",
      enabled: true,
      body_chars: 1234,
    },
    {
      id: "k-2",
      name: "anatomy-check",
      description: "结构检查",
      enabled: false,
      body_chars: 567,
    },
  ],
} satisfies ApiStubTable as ApiStubTable;

/** 端点配置：列表＋选中行详情（高级参数折叠）。 */
export const Endpoints: Story = {
  args: { section: "endpoints" },
  parameters: { apiStubs: ENDPOINTS_STUBS },
};

/** 端点配置 · 展开态：play 点触发行展开高级参数。
 * play 先等详情列落成（boot 取数异步，触发行在选中详情里），再点、再等展开后的字段。 */
export const EndpointsAdvExpanded: Story = {
  args: { section: "endpoints" },
  parameters: { apiStubs: ENDPOINTS_STUBS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("保存更改");
    await userEvent.click(canvas.getByRole("button", { name: /高级参数/ }));
    await canvas.findByText("思考模式");
  },
};

/** 技能：左列表＋右详情。 */
export const Skills: Story = {
  args: { section: "skills" },
  parameters: { apiStubs: SKILLS_STUBS },
};

/**
 * 端点配置 · 窄视口：390 宽查看。
 * 窄屏两态交互（收起／暂展）实现侧尚未施工——
 * 本 story 呈现实现现状的响应式形态，收展交互施工后 story 自动跟上。
 */
export const EndpointsNarrow: Story = {
  args: { section: "endpoints" },
  parameters: { apiStubs: ENDPOINTS_STUBS },
};
