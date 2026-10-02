import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";

import type { ApiStubTable } from "../../.storybook/preview";
import { Sidebar } from "./sidebar";

/**
 * Sidebar 的样例 stories（展开／折叠／设置模式三态）。
 * 壳级状态全部经 props 摆拍（App 持有、侧栏无自身 state）；服务状态点挂载即探测
 * GET /api/service——桩回运行中。桌面常驻与窄屏抽屉共用本组件（抽屉包 Dialog 由壳层管）。
 */
const meta = {
  title: "App shell/Sidebar",
  component: Sidebar,
  args: {
    page: "prompts",
    workPage: "prompts",
    collapsed: false,
    navigationOpen: false,
    settingsSection: "endpoints",
    mode: "light",
    setPage: () => {},
    setCollapsed: () => {},
    setNavigationOpen: () => {},
    setSettingsSection: () => {},
    setMode: () => {},
    openSettings: () => {},
  } satisfies Partial<ComponentProps<typeof Sidebar>>,
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

const SERVICE_STUBS = {
  "GET /api/service": {
    version: "0.1.0",
    host: "127.0.0.1",
    port: 8765,
    started_at: "2026-01-01T00:00:00+00:00",
    log_file: "/tmp/dsf/logs/server.log",
  },
} satisfies ApiStubTable as ApiStubTable;

/** 展开态：品牌区＋主导航＋设置节＋脚注。 */
export const Expanded: Story = {
  parameters: { apiStubs: SERVICE_STUBS },
};

/** 折叠态：16 宽纵排图标，状态点居最下。 */
export const Collapsed: Story = {
  args: { collapsed: true },
  parameters: { apiStubs: SERVICE_STUBS },
};

/** 设置模式：品牌区整段隐藏、首行返回工作区＋设置组＋三子页项。 */
export const SettingsMode: Story = {
  args: { page: "settings", settingsSection: "endpoints" },
  parameters: { apiStubs: SERVICE_STUBS },
};
