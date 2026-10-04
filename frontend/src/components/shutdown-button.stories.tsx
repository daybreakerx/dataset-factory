import type { Meta, StoryObj } from "@storybook/react-vite";

import { ShutdownButton } from "./shutdown-button";

/** ShutdownButton 的样例 stories：页头图标态与侧栏图标态（原「服务运行」子页的文字态
 * 随该子页 2026-10-05 改版撤除）。确认弹窗的形态由 DialogShell stories 覆盖；
 * 停机请求只在用户点确认后发生，样例不交互。 */
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
