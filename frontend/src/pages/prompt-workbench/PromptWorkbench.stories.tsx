import type { Meta, StoryObj } from "@storybook/react-vite";

import type { ApiStubTable } from "../../../.storybook/preview";
import { ChatSessionProvider } from "../../session/chat-session";
import { PromptWorkbench } from "./PromptWorkbench";

/**
 * PromptWorkbench 的样例 stories（默认态与对话态）。
 * 数据面：boot 取四表（prompts / skills / endpoints / strategies）＋会话恢复
 * （GET /api/sessions/latest，认领路径）——对话态桩回带消息的快照、默认态回 404 空白起步。
 */
const meta = {
  title: "Pages/PromptWorkbench",
  component: PromptWorkbench,
  args: {
    onNavigateToSettings: () => {},
  },
  // 会话域住在页面边界之外（App 壳层包 Provider）：story 里同样先包 Provider 再挂页面。
  decorators: [
    (Story) => (
      <ChatSessionProvider>
        <Story />
      </ChatSessionProvider>
    ),
  ],
} satisfies Meta<typeof PromptWorkbench>;

export default meta;
type Story = StoryObj<typeof meta>;

const BASE_STUBS = {
  "GET /api/prompts": [
    { id: "p-1", name: "详细描述", description: "通用详细描述提示词" },
    { id: "p-2", name: "简短描述", description: "一句话描述" },
  ],
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
  "GET /api/strategies": [
    {
      id: "st1",
      name: "基线策略",
      description: "样例策略",
      enabled: true,
      prompt_id: "p-1",
      skill_ids: ["k-1"],
      endpoint_id: "e-1",
      updated_at: "2026-01-01T00:00:00+00:00",
    },
  ],
} satisfies ApiStubTable as ApiStubTable;

/** 默认态：空对话列、新建策略草稿（无会话快照，404 空白起步）。 */
export const Default: Story = {
  parameters: {
    apiStubs: {
      ...BASE_STUBS,
      "GET /api/sessions/latest": null,
    } satisfies ApiStubTable as ApiStubTable,
  },
};

/** 对话态：认领路径带回 st1 桶的最近会话，对话列有历史消息。 */
export const WithConversation: Story = {
  parameters: {
    apiStubs: {
      ...BASE_STUBS,
      "GET /api/sessions/latest": {
        session_id: "sess-1",
        strategy_id: "st1",
        settings: { prompt_id: "p-1", skill_ids: ["k-1"] },
        messages: [
          {
            role: "user",
            text: "给这张商品图写一条详情页文案。",
            attachment: null,
            partial: false,
          },
          {
            role: "assistant",
            text: "样例回复：主体清晰、背景干净，详情页文案以卖点开头，辅以使用场景收尾。",
            attachment: null,
            partial: false,
            elapsed_ms: 4200,
          },
        ],
      },
    } satisfies ApiStubTable as ApiStubTable,
  },
};
