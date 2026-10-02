import type { Meta, StoryObj } from "@storybook/react-vite";

import { DialogShell } from "./dialog-shell";

/**
 * DialogShell 的样例 stories（批16.2 组件 stories 先例）：摆拍弹窗族件的两种标准页脚形态。
 * open 常开（story 只呈现开态）；onOpenChange 为空实现——样例不含关闭交互。
 */
const meta = {
  title: "Components/DialogShell",
  component: DialogShell,
  args: {
    open: true,
    onOpenChange: () => {},
  },
} satisfies Meta<typeof DialogShell>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 确认类标准形态：标准头行＋正文＋备注槽＋取消/确认对（族件缺省 variant：取消 outline、确认 default）。 */
export const Confirm: Story = {
  args: {
    title: "删除配置",
    description: "将删除配置「default」，引用它的策略会变为缺失。",
    children: (
      <p className="text-t-sm text-text-2">示例正文：确认类弹窗的标准头行与页脚。</p>
    ),
    note: "此操作不可撤销",
    cancel: { label: "取消", onClick: () => {} },
    confirm: { label: "删除", onClick: () => {} },
  },
};

/** 表单类形态：头行＋children 自组表单体＋标准页脚。 */
export const Form: Story = {
  args: {
    title: "新建策略",
    children: (
      <p className="text-t-sm text-text-2">示例正文：表单体由 children 自组。</p>
    ),
    cancel: { label: "取消", onClick: () => {} },
    confirm: { label: "创建", onClick: () => {} },
  },
};
