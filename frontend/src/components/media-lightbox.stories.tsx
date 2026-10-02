import type { Meta, StoryObj } from "@storybook/react-vite";
import logo from "../logo-speed-d.png";
import { MediaLightbox } from "./media-lightbox";

/** MediaLightbox 的样例 stories：图片原件预览态（受控组件，target 传非空即开态）。 */
const meta = {
  title: "Components/MediaLightbox",
  component: MediaLightbox,
  args: {
    onClose: () => {},
  },
} satisfies Meta<typeof MediaLightbox>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 图片预览开态（用本仓 logo 作样例原件）。 */
export const ImagePreview: Story = {
  args: {
    target: { url: logo, kind: "image", name: "sample-image.png" },
  },
};

/** 关态（target 为 null 时浮层不渲染，作为对照样例）。 */
export const Closed: Story = {
  args: {
    target: null,
  },
};
