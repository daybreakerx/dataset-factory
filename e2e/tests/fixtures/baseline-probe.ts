import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, type Page } from "@playwright/test";

import { stubApi } from "./api-stubs";

// 视觉与请求基线的共享底座：探针、稳定化、起屏、采集与档位切换。
// 原逻辑都在 visual-baseline.spec.ts 单文件里；批0 扩出「渲染等价档」与「全档只报不卡
// 通道」后，同一套探针要被三处使用（基线断言 / 全档存档 / 当批 dump），抽到这里单源。
//
// 档位口径（前端重构线规划档 §4.2 的落地）：
//   full（默认）  —— 全列：类名 + 结构路径 + 渲染等价全开。批1（纯移动）与批17（收口）用。
//   render        —— 类名不采集；结构路径退化为「去匿名段 + 同 key 兄弟序号」的行 key，
//                    只作配对、不作比对列。批2~15（拆解期）用。
// 切档用环境变量：BASELINE_TIER=render npx playwright test tests/visual-baseline.spec.ts
// （切档会改变探针输出内容，需配合 --update-snapshots 重采；见批0.5 演练。）

const NEWLINE = "\n";

export type BaselineTier = "full" | "render";

/** 采集函数签名：断言式 spec 与存档 spec 各自实现（快照断言 / dump 落盘）。 */
export type SnapFn = (page: Page, sink: string[], name: string) => Promise<void>;

/** 当批采集档位：读 BASELINE_TIER（缺省 full）。dump（只报不卡）模式强制全档——
 * 它的比对对象是批0 的全档存档，口径必须一致（规划档 §4.2）。 */
export function getTier(): BaselineTier {
  if (isDumpMode()) {
    return "full";
  }
  return process.env.BASELINE_TIER === "render" ? "render" : "full";
}

/** dump（只报不卡）模式：BASELINE_REPORT=1 时不做快照断言，探针文本落盘给比较器。 */
export function isDumpMode(): boolean {
  return process.env.BASELINE_REPORT === "1";
}

/** 截图落点：仓外 .verify/shots/current（PNG 与字体渲染绑定，不入仓、只做本机对照）。 */
function shotPath(name: string): string {
  const dir = path.resolve(process.cwd(), "../.verify/shots/current");
  mkdirSync(dir, { recursive: true });
  return path.join(dir, `${name}.png`);
}

/** dump 文本落点：.verify/baseline-dump/（不入仓；比较器从这里取当批产物对存档）。 */
export function dumpPath(name: string): string {
  const dir = path.resolve(process.cwd(), ".verify/baseline-dump");
  mkdirSync(dir, { recursive: true });
  return path.join(dir, `${name}.txt`);
}

/** 探针前的稳定化：关掉过渡与进入动画并等两帧。
 *
 * 实测原因：页面大量元素带 `transition-colors` 与入场动画，取数时刻落在过渡中间就会
 * 拿到插值色（同一份代码两次采集色差可达 60/255），快照因此假红。稳定化只影响取值时机，
 * 不改任何布局与类名；探针本身不采集 transition/animation 属性，注入的样式不进快照。
 */
export async function settle(page: Page, sink: string[]): Promise<void> {
  await page.addStyleTag({
    content: "*,*::before,*::after{transition:none !important;animation:none !important}",
  });
  // Radix Dialog/Popover 关闭依赖 animationend；上面的 animation:none 让卸载永远等不到
  // 信号，data-state="closed" 的遮罩层会残留 DOM——既拦截后续点击、又作为可见元素混进
  // 探针。这是禁动画装置的伪象（产品在真浏览器里正常卸载），统一摘掉。
  await page.evaluate(() => {
    document
      .querySelectorAll('[data-state="closed"][data-slot="dialog-overlay"]')
      .forEach((element) => element.remove());
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setTimeout(resolve, 60);
          });
        });
      }),
  );
  // 路由级分包（React.lazy + <Suspense fallback={null}>）让一次路由切换要等一个网络往返；
  // React 在边界重挂时会把旧子树留着但置 display:none，所以「有没有子节点」不能当信号。
  // 取「可见元素数连续三次一致」为准（三次约 450ms，够分包落地，也不会被 3s 轮询误伤）。
  let stable = 0;
  let previous = "";
  for (let round = 0; round < 40 && stable < 4; round += 1) {
    const count = await page.evaluate(
      () =>
        // 只数「渲染出来的」元素：与 probe 同样的可见性口径，避免隐藏子树把计数带偏。
        Array.from(document.body.querySelectorAll("*")).filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none"
          );
        }).length,
    );
    const signature = `${String(count)}:${String(sink.length)}`;
    stable = signature === previous && count > 0 ? stable + 1 : 0;
    previous = signature;
    await page.waitForTimeout(120);
  }
}

interface ProbeRow {
  key: string;
  cells: string[];
}

/**
 * 取一屏的计算样式探针。
 *
 * 每行一个可见元素。列组成按档位：
 * - full：结构路径（全匿名段）| data-slot | data-testid | aria-label | role | 类名 | 归一化文字 |
 *   几何 + 样式列（见下）。
 * - render：行 key（去匿名段路径 + 同 key 兄弟序号）| data-testid | aria-label | role |
 *   归一化文字 | 几何 + 样式列。类名与 data-slot 不采集（它们是实现标记，渲染等价不管）。
 *
 * 样式列（两档一致）：几何 / 字号 / 字重 / 字色 / 底色 / 四边边宽 / 边色 / 圆角 / 四边 padding /
 * gap / display / box-shadow / z-index / overflow / line-height / letter-spacing /
 * transform / position / rotate / opacity。
 * 扩列原因（批0.2⑤）：影/层级/溢出/行高/字距/变换/定位恰是族件（影）、浮层（层级）、
 * 滚动容器（溢出）最会动的维度；rotate 单列是因为 Tailwind 4 的 rotate-* 走独立 CSS
 * `rotate` 属性、只看 transform 会漏旋转；opacity 原先只当可见性过滤、半透明态变化采不到。
 *
 * @param page 已经渲染好目标状态的页面对象。
 * @returns 每行一个可见元素的探针文本（` | ` 分列）。
 */
export async function probe(page: Page): Promise<string> {
  const tier = getTier();
  const rows: ProbeRow[] = await page.evaluate((mode: BaselineTier) => {
    const css = getComputedStyle;
    const visible = (element: Element): boolean => {
      const computed = css(element);
      const rect = element.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        computed.visibility !== "hidden" &&
        computed.display !== "none" &&
        Number(computed.opacity) > 0.01
      );
    };
    const digits = (value: string): string => value.replace(/\d/g, "#");
    const ownText = (element: Element): string => {
      const texts = Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "");
      return digits(texts.join(" ").replace(/\s+/g, " ").trim());
    };

    // 全档结构路径：body 到元素逐级 tag#同胞序号，匿名段全保留（原口径，比对列）。
    const pathOf = (element: Element): string => {
      const parts: string[] = [];
      let node: Element | null = element;
      while (node && node !== document.body) {
        const parent: Element | null = node.parentElement;
        const index = parent
          ? Array.prototype.indexOf.call(parent.children, node satisfies Element as Element)
          : 0;
        parts.unshift(`${node.tagName.toLowerCase()}#${index}`);
        node = parent;
      }
      return parts.join("/");
    };

    // 渲染等价档行 key 的段：只认「带身份」的祖先段——有 data-slot / data-testid /
    // role / aria-label / 自有文字之一才算数，其余匿名段剔除。纯文本 diff 的配对语义
    // 靠「同 key 兄弟序号」补（同 keyOf 之后统一编号，见 collectRows）。
    // （v4 重设计原因：data-slot＋aria-label＋归一化文字三字段在真实页面大面积同时为空，
    // 原行 key 退化成空串撞键——见规划档批0.5 与第三轮审计 C1。）
    const segmentOf = (node: Element): string | null => {
      const slot = node.getAttribute("data-slot") ?? "";
      const testid = node.getAttribute("data-testid") ?? "";
      const role = node.getAttribute("role") ?? "";
      const label = node.getAttribute("aria-label") ?? "";
      const own = ownText(node);
      if (slot === "" && testid === "" && role === "" && label === "" && own === "") {
        return null;
      }
      return [
        node.tagName.toLowerCase(),
        slot,
        testid,
        role,
        label,
        own,
      ].filter((part) => part !== "").join("¦");
    };
    const keyPathOf = (element: Element): string => {
      const parts: string[] = [];
      let node: Element | null = element;
      while (node && node !== document.body) {
        const segment = node instanceof Element ? segmentOf(node) : null;
        if (segment !== null) {
          parts.unshift(segment);
        }
        node = node.parentElement;
      }
      return parts.join("/");
    };

    const elements = Array.from(document.body.querySelectorAll("*")).filter(visible);
    // 先过一遍拿 key 与同 key 兄弟序号（render 档），再逐元素采样式列。
    const ranks = new Map<Element, string>();
    const siblingCounter = new Map<string, number>();
    for (const element of elements) {
      if (mode === "render") {
        const parent = element.parentElement;
        const parentKey =
          parent === null || parent === document.body ? "" : keyPathOf(parent);
        const key = keyPathOf(element);
        const siblingKey = `${parentKey}›${key}`;
        const rank = (siblingCounter.get(siblingKey) ?? 0) + 1;
        siblingCounter.set(siblingKey, rank);
        ranks.set(element, `${key}#${rank}`);
      } else {
        ranks.set(element, pathOf(element));
      }
    }

    return elements.map((element) => {
      const computed = css(element);
      const rect = element.getBoundingClientRect();
      const cells = [];
      if (mode === "full") {
        cells.push(
          element.getAttribute("data-slot") ?? "",
        );
      }
      cells.push(
        element.getAttribute("data-testid") ?? "",
        element.getAttribute("aria-label") ?? "",
        element.getAttribute("role") ?? "",
      );
      if (mode === "full") {
        cells.push((element.getAttribute("class") ?? "").replace(/\s+/g, " ").trim());
      }
      cells.push(
        ownText(element),
        `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
        computed.fontSize,
        computed.fontWeight,
        computed.color,
        computed.backgroundColor,
        `${computed.borderTopWidth}/${computed.borderRightWidth}/${computed.borderBottomWidth}/${computed.borderLeftWidth}`,
        computed.borderTopColor,
        computed.borderTopLeftRadius,
        `${computed.paddingTop} ${computed.paddingRight} ${computed.paddingBottom} ${computed.paddingLeft}`,
        computed.gap,
        computed.display,
        computed.boxShadow,
        computed.zIndex,
        computed.overflow,
        computed.lineHeight,
        computed.letterSpacing,
        computed.transform,
        computed.position,
        computed.rotate,
        computed.opacity,
      );
      const key = ranks.get(element) ?? "";
      return { key, cells };
    });
  }, tier);

  return rows.map((row) => [row.key, ...row.cells].join(" | ")).join(NEWLINE);
}

/** 起一屏：设视口、装路由桩（overrides 按用例替换个别端点）、打开首页并等字体就绪。 */
export async function boot(
  page: Page,
  overrides: Record<string, unknown> = {},
  viewport: { width: number; height: number } = { width: 1440, height: 900 },
): Promise<string[]> {
  const sink: string[] = [];
  await page.setViewportSize(viewport);
  await stubApi(page, sink, overrides);
  await page.goto("/");
  await page.waitForFunction(() => document.fonts.status === "loaded");
  return sink;
}

/** 采集当前屏：探针 + 请求清单（快照断言或 dump 落盘）+ 落一张截图供目检。 */
export async function snap(page: Page, sink: string[], name: string): Promise<void> {
  await settle(page, sink);
  const styles = await probe(page);
  if (isDumpMode()) {
    // 文件名连字符分隔：与 Playwright 快照命名规范一致（快照机制会把点规范成连字符），
    // 与全档存档（_baseline-archive）、比较器共用一套约定。
    writeFileSync(dumpPath(`${name}-styles`), styles + NEWLINE, "utf-8");
    writeFileSync(dumpPath(`${name}-requests`), sink.join(NEWLINE) + NEWLINE, "utf-8");
  } else {
    expect(styles + NEWLINE).toMatchSnapshot(`${name}.styles.txt`);
    expect(sink.join(NEWLINE) + NEWLINE).toMatchSnapshot(`${name}.requests.txt`);
  }
  await page.screenshot({ path: shotPath(name), animations: "disabled" });
}
