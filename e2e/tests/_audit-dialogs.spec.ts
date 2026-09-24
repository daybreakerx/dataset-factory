import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { stubApi } from "./fixtures/api-stubs";

// 【临时件】弹窗取证：把真前端跑起来，逐个点开弹窗，截真图并把真实盒尺寸/计算样式落盘。
//
// 目的：重构前的现状取证。之前手写 CSS 复原弹窗宽度会错位，这里改成一律从真 DOM 量。
// 产物（都在 .verify/ 下，本机产物、不入仓）：
//   .verify/dialog-shots/*.png            每个弹窗一张真截图（按组件元素截，不是整屏）
//   .verify/dialog-shots/measure.tsv      每个弹窗的真实测量值
// 跑法：npx playwright test _audit-dialogs   （用完即删，别留在套件里）

const OUT = path.resolve(process.cwd(), "../.verify/dialog-shots");

/** 一个弹窗的测量结果。 */
type Measure = Record<string, string>;

/** 关掉过渡与入场动画，避免截图落在过渡中间。 */
async function freeze(page: Page): Promise<void> {
  await page.addStyleTag({
    content:
      "*,*::before,*::after{transition:none !important;animation:none !important}",
  });
}

/** 从真 DOM 量当前打开的弹窗。 */
async function measure(page: Page): Promise<Measure | null> {
  return page.evaluate(() => {
    const box = document.querySelector<HTMLElement>(
      '[data-slot="dialog-content"]',
    );
    if (!box) return null;
    const cs = getComputedStyle(box);
    const rect = box.getBoundingClientRect();
    const title =
      box.querySelector('[data-slot="dialog-title"]')?.textContent?.trim() ?? "";
    const desc =
      box.querySelector('[data-slot="dialog-description"]')?.textContent?.trim() ??
      "";
    return {
      title,
      desc: desc.slice(0, 40),
      width: String(Math.round(rect.width)),
      height: String(Math.round(rect.height)),
      padding: cs.padding,
      radius: cs.borderTopLeftRadius,
      borderWidth: cs.borderTopWidth,
      borderColor: cs.borderTopColor,
      shadow: cs.boxShadow.slice(0, 60),
      gap: cs.gap,
      maxHeight: cs.maxHeight,
    };
  });
}

/** 取当前页所有可见按钮的可见文字（去重、保序、剔掉不该点的），用作触发入口清单。 */
async function triggerLabels(page: Page): Promise<string[]> {
  const raw = await page.locator("button:visible").evaluateAll((els) =>
    els
      .map((el) =>
        (
          el.getAttribute("aria-label") ??
          el.textContent ??
          ""
        )
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter((text) => text.length > 0 && text.length < 24),
  );
  return Array.from(new Set(raw)).filter((text) => !SKIP_LABELS.has(text));
}

/** 不该点的入口：导航类（会把页面带走）与「关闭服务」（会把被测服务关掉）。 */
const SKIP_LABELS = new Set([
  "设置",
  "打标",
  "工作台",
  "返回工作区",
  "关闭服务",
  "端点配置",
  "技能",
  "服务运行",
  "保存更改",
  "测试连接",
]);

/** 回打标页并选中批次（每次点击前的复位，避免 DOM 变化让索引失真）。
 *
 * 四处实测坑（都写在注释里，免得后面的人重踩）：
 * 1. `goto("/")` 之后应用会**恢复上次所在的页面**（三期的页面状态保持），若上次停在设置页，
 *    侧栏里就没有「打标」——主导航被设置子导航替换了，必须先点「返回工作区」退回来。
 * 2. 恢复的不只是「哪一页」，还有页内子状态（比如打标页停在「素材预览」时，「批次概览」整块不在），
 *    所以复位必须**先清掉本地状态再重载**，否则拿到的不是干净起点。
 * 3. 浮层开着时整页被标 `aria-hidden`，页面里的按钮按角色查不到；所以先按两次 Escape。
 * 4. 断言的落点要挑「一定在的东西」（主导航按钮），不要挑某个业务区域。
 */
async function resetLabeling(page: Page): Promise<void> {
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  const back = page.getByRole("button", { name: "返回工作区" });
  if ((await back.count()) > 0) {
    await back.first().click({ timeout: 8000 }).catch(() => undefined);
  }
  await page
    .getByRole("button", { name: "打标", exact: true })
    .click({ timeout: 8000 });
  await expect(
    page.getByRole("button", { name: "打标", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(300);
  await freeze(page);
}

/** 复位到「工作目录设置」抽屉打开的状态。 */
async function resetWorkdirDrawer(page: Page): Promise<void> {
  await resetLabeling(page);
  await page.getByRole("button", { name: "选择工作目录与批次" }).click();
  await page
    .getByRole("button", { name: /工作目录设置/ })
    .first()
    .click();
  await page.waitForTimeout(400);
}

test.describe("弹窗取证", () => {
  // 这是重构取证的临时件，不属于门禁：默认跳过，只有显式开关时才跑（免得被
  // `npx playwright test` 与 CI 顺手捡走，拖慢门禁还引入无关的红）。
  // 跑法：DIALOG_AUDIT=1 npx playwright test _audit-dialogs
  test.skip(
    process.env.DIALOG_AUDIT !== "1",
    "取证用临时件：加 DIALOG_AUDIT=1 才跑",
  );
  // 逐个入口点开 = 几十次「复位 + 试开」往返，远超默认的 30 秒用例预算。
  test.setTimeout(15 * 60 * 1000);
  // 试开失败要走得快：一次点不开就换下一个入口，别把预算烧在等待上。
  test.use({ actionTimeout: 4000 });

  test("逐个点开弹窗、截真图并量真值", async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    const sink: string[] = [];
    await stubApi(page, sink, {});
    await page.waitForFunction(() => document.fonts.status === "loaded");

    const measures: (Measure & { shot: string; phase: string })[] = [];
    const seen = new Set<string>();
    let seq = 0;

    /** 点一个入口，若开了弹窗就截图 + 测量，然后关掉。 */
    const poke = async (
      phase: string,
      label: string,
      reopen: (p: Page) => Promise<void>,
    ): Promise<void> => {
      await reopen(page);
      const target = page.getByRole("button", { name: label, exact: true });
      if ((await target.count()) === 0) return;
      await target.first().click({ timeout: 3000 }).catch(() => undefined);
      const box = page.locator('[data-slot="dialog-content"]');
      const opened = await box
        .waitFor({ state: "visible", timeout: 1500 })
        .then(() => true)
        .catch(() => false);
      if (!opened) return;
      await page.waitForTimeout(250);
      const m = await measure(page);
      if (!m) return;
      const key = `${m.title}|${m.width}x${m.height}`;
      if (seen.has(key)) return;
      seen.add(key);
      seq += 1;
      const slug = String(seq).padStart(2, "0");
      const shot = `${slug}-${(m.title || label).replace(/[^\p{Script=Han}\w-]/gu, "").slice(0, 18)}`;
      await box.screenshot({ path: path.join(OUT, `${shot}.png`) });
      measures.push({ ...m, shot, phase });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
    };

    // 阶段一：打标页主界面上的入口
    const mainLabels = await (async () => {
      await resetLabeling(page);
      return triggerLabels(page);
    })();
    for (const label of mainLabels) {
      await poke("打标页", label, resetLabeling);
    }

    // 阶段二：工作目录设置抽屉里的入口（清理 / 危险操作 / 修改路径 / 新增策略等）
    const drawerLabels = await (async () => {
      await resetWorkdirDrawer(page);
      return triggerLabels(page);
    })();
    for (const label of drawerLabels) {
      await poke("工作目录设置", label, resetWorkdirDrawer);
    }

    // 落盘测量值
    const header = [
      "phase",
      "title",
      "width",
      "height",
      "padding",
      "radius",
      "borderWidth",
      "maxHeight",
      "gap",
      "shot",
    ];
    const tsv = [
      header.join("\t"),
      ...measures.map((m) =>
        header.map((k) => String(m[k] ?? "")).join("\t"),
      ),
    ].join("\n");
    writeFileSync(path.join(OUT, "measure.tsv"), `${tsv}\n`, "utf8");

    // 让结论在测试输出里可见（后台跑测试时别接 tail）
    console.log(`\n===== 抓到 ${measures.length} 个弹窗 =====`);
    for (const m of measures) {
      console.log(
        `${m.phase}\t${m.width}x${m.height}\tpadding=${m.padding}\tradius=${m.radius}\t${m.title || "(无标题)"}`,
      );
    }
    expect(measures.length).toBeGreaterThan(0);
  });
});
