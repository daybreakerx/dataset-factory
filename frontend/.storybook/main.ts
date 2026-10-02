import type { StorybookConfig } from "@storybook/react-vite";

/**
 * Storybook 配置（前端全量重构线 批16 立）。
 *
 * stories 与组件同目录（src 下任意层的 .stories.tsx 文件）——就近形态与目录分层契约一致；
 * 框架走 @storybook/react-vite，与应用同一条 Vite 链（复用根 vite.config.ts 的
 * react 与 tailwindcss 插件，globals.css 的令牌在 story 里同样生效）。
 */
const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  framework: "@storybook/react-vite",
};

export default config;
