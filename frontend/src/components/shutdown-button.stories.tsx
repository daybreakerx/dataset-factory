import type { Meta, StoryObj } from "@storybook/react-vite";

import { ShutdownButton } from "./shutdown-button";

/** ShutdownButton 的样例 stories：图标态（页头）与文字态（服务运行子页状态卡）。
 * 确认弹窗的形态由 DialogShell stories 覆盖；停机请求只在用户点确认后发生，样例不交互。 */
const meta = {
  title: "Components/ShutdownButton",
  component: ShutdownButton,
} satisfies Meta<typeof ShutdownButton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 图标态：页头窄位（outline 形态）。 */
export const IconOutline: Story = {
  args: {},
};

/** 图标态：侧栏内（ghost 形态、悬停红）。 */
export const IconSidebar: Story = {
  args: { sidebar: true },
};

/** 文字态：服务运行子页（destructive 实底）。 */
export const Expanded: Story = {
  args: { expanded: true },
};
