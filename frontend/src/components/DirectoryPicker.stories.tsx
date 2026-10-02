import type { Meta, StoryObj } from "@storybook/react-vite";

import type { ApiStubTable } from "../../.storybook/preview";
import { DirectoryPicker } from "./DirectoryPicker";

/** DirectoryPicker 的样例 stories：目录浏览弹窗的摆拍态。
 * 挂载即取目录列表——数据面经 fetch stub 回放（parameters.apiStubs），形制与 e2e 桩表同。 */
const meta = {
  title: "Components/DirectoryPicker",
  component: DirectoryPicker,
  args: {
    onClose: () => {},
    onSelect: () => {},
  },
} satisfies Meta<typeof DirectoryPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

const LISTING = {
  entries: [
    {
      kind: "directory",
      name: "素材库",
      path: "/data/素材库",
      modified_at: "2026-01-01T00:00:00+00:00",
      size: null,
    },
    {
      kind: "directory",
      name: "输出",
      path: "/data/输出",
      modified_at: "2026-01-01T00:00:00+00:00",
      size: null,
    },
    {
      kind: "file",
      name: "readme.md",
      path: "/data/readme.md",
      modified_at: "2026-01-01T00:00:00+00:00",
      size: 2048,
    },
  ],
  hostname: "probe",
  parent: null,
  path: "/data",
  system: "windows",
  unavailable_count: 0,
};

const CAPABILITIES = { supported: true, home: "/home", separator: "/", roots: ["/"] };

/** 工作目录选择形态：目录浏览＋底部动作对（默认 props 组合）。 */
export const PickDirectory: Story = {
  parameters: {
    apiStubs: {
      "GET /api/filesystem": LISTING,
    } satisfies ApiStubTable as ApiStubTable,
  },
};

/** 只读浏览形态（browseOnly：额外探测「在文件管理器打开」能力）。 */
export const BrowseOnly: Story = {
  args: {
    browseOnly: true,
  },
  parameters: {
    apiStubs: {
      "GET /api/filesystem": LISTING,
      "GET /api/filesystem/capabilities": CAPABILITIES,
    } satisfies ApiStubTable as ApiStubTable,
  },
};

/** 文件选择形态（files：列出文件、按扩展名过滤）。 */
export const PickFile: Story = {
  args: {
    files: true,
    suffixes: [".md"],
  },
  parameters: {
    apiStubs: {
      "GET /api/filesystem": LISTING,
    } satisfies ApiStubTable as ApiStubTable,
  },
};
