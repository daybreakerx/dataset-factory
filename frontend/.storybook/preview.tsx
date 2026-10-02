import type { Decorator, Preview } from "@storybook/react-vite";
import { TooltipProvider } from "../src/components/ui/tooltip";
import "../src/globals.css";

/**
 * 全局 preview：story 渲染环境统一注入三层东西——
 * ① 应用样式入口 globals.css（Tailwind 4 + tokens，与实现同一份）；
 * ② TooltipProvider（与 App.tsx 外壳同语义：tooltip 是全局可用件，不逐 story 重复包）；
 * ③ fetch stub 装饰器（页面挂载即取数，story 运行时没有 Playwright 路由层，
 *    不打桩则所有取数点落错误态）。
 */

/** 桩表形状：键 = `方法 /api/路径`（不含 query），值 = JSON 响应体；null 表示回 404。
 * 与 e2e/tests/fixtures/api-stubs.ts 同形制（固定输入才有固定输出），不共享实体——
 * 那份住 e2e 仓、这份住 story 运行时，演进各自独立。 */
export type ApiStubTable = Record<string, unknown>;

// 模块加载时抓一次原始 fetch：装饰器随 story 切换反复覆盖 window.fetch，不叠层。
const originalFetch = window.fetch.bind(window);

function stubResponse(table: ApiStubTable, method: string, pathname: string): Response {
  const key = `${method} ${pathname}`;
  if (!(key in table)) {
    // 未登记的 /api/* 一律 404：story 需要的每个取数点都必须显式登记，缺了看得见。
    return new Response(null, { status: 404 });
  }
  const body = table[key];
  if (body === null) {
    return new Response(null, { status: 404 });
  }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** fetch stub 装饰器：把 /api/* 请求按 story 的 parameters.apiStubs 桩表拦截回放，
 * 其余请求（图片、字体等静态资源）放行原始 fetch。 */
export const apiStubDecorator: Decorator = (Story, context) => {
  const table = (context.parameters.apiStubs as ApiStubTable | undefined) ?? {};
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string" || input instanceof URL
        ? new URL(input.toString(), window.location.origin)
        : new URL(input.url, window.location.origin);
    if (!url.pathname.startsWith("/api/")) {
      return originalFetch(input, init);
    }
    const method = (
      init?.method ??
      (typeof input === "object" && !(input instanceof URL) ? input.method : "GET") ??
      "GET"
    ).toUpperCase();
    return Promise.resolve(stubResponse(table, method, url.pathname));
  };
  return Story(context);
};

/** 外壳级包裹：TooltipProvider 与 fetch stub 组成每个 story 的公共渲染环境。 */
const shellDecorator: Decorator = (Story) => {
  return (
    <TooltipProvider delayDuration={0}>
      <Story />
    </TooltipProvider>
  );
};

/** story 间的站点存储隔离：页面组件的 boot 行为读 localStorage（上次页面 / 策略镜像 /
 * 编辑器镜像），残留会改变渲染路径、同一 story 出两样——每个 story 渲染前清空，
 * 与 E2E 的「清存储再 reload」同口径。 */
const storageResetDecorator: Decorator = (Story) => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  return Story();
};

const preview: Preview = {
  decorators: [storageResetDecorator, shellDecorator, apiStubDecorator],
};

export default preview;
