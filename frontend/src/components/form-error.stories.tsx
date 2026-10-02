import type { Meta, StoryObj } from "@storybook/react-vite";

import { FormError } from "./form-error";

/** FormError 的样例 stories：行内错误提示（role="alert" 即时播报给读屏）。 */
const meta = {
  title: "Components/FormError",
  component: FormError,
} satisfies Meta<typeof FormError>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 弹窗正文区的失败行（族件 note 槽之外的自由失败位）。 */
export const InlineError: Story = {
  args: {
    children: "保存失败：名称不能为空。",
    className: "text-t-sm text-destructive",
  },
};
