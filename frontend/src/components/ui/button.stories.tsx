import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "./button";

/** Button 的变体全览样例：一眼看全 variant × size 两轴的现役形态（尺寸用 default 档、变体逐个摆）。 */
const meta = {
  title: "Components/ui/Button",
  component: Button,
  args: {
    type: "button",
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 主色实底（default 档）：表单确认、主动作。 */
export const Primary: Story = {
  args: { children: "主按钮" },
};

/** 描边（outline）：取消、次级动作。 */
export const Outline: Story = {
  args: { variant: "outline", children: "取消" },
};

/** 幽灵（ghost）：侧栏脚注、行内次要动作。 */
export const Ghost: Story = {
  args: { variant: "ghost", children: "次级" },
};

/** 危险红字（destructive）：透明底红字，悬停红底。 */
export const DestructiveText: Story = {
  args: { variant: "destructive", children: "删除" },
};

/** 危险实底（destructive-fill）：破坏性主动作（如「关闭服务」文字态）。 */
export const DestructiveFill: Story = {
  args: { variant: "destructive-fill", children: "关闭服务" },
};

/** 危险降饱和实底（destructive-soft）。 */
export const DestructiveSoft: Story = {
  args: { variant: "destructive-soft", children: "停止跑批" },
};

/** 强调（accent）：主色浅底强调字。 */
export const Accent: Story = {
  args: { variant: "accent", children: "强调" },
};

/** 次级实底（secondary）。 */
export const Secondary: Story = {
  args: { variant: "secondary", children: "次级实底" },
};

/** 链接形态（link）。 */
export const Link: Story = {
  args: { variant: "link", children: "链接钮" },
};

/** 禁用态：灰阶实色（非 opacity 半透明）。 */
export const Disabled: Story = {
  args: { children: "禁用", disabled: true },
};

/** 四档高度全览（default / sm / lg / xs 圆胶囊）。 */
export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Button size="lg">大档</Button>
      <Button>中档</Button>
      <Button size="sm">小档</Button>
      <Button size="xs">胶囊</Button>
    </div>
  ),
  parameters: { controls: { disable: true } },
};
