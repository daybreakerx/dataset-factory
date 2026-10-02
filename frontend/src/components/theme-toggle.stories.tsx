import type { Meta, StoryObj } from "@storybook/react-vite";

import { ThemeToggle } from "./theme-toggle";

/** ThemeToggle 的样例 stories：三态循环按钮，受控摆拍（mode 经 props、点击经 onModeChange）。 */
const meta = {
  title: "Components/ThemeToggle",
  component: ThemeToggle,
  args: {
    onModeChange: () => {},
  },
} satisfies Meta<typeof ThemeToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 亮色态（侧栏外的 outline 形态）。 */
export const Light: Story = {
  args: { mode: "light" },
};

/** 暗色态。 */
export const Dark: Story = {
  args: { mode: "dark" },
};

/** 跟随系统态。 */
export const System: Story = {
  args: { mode: "system" },
};

/** 侧栏内的 ghost 形态。 */
export const SidebarGhost: Story = {
  args: { mode: "light", sidebar: true },
};
