import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { test, type Page } from "@playwright/test";

import { stubApi } from "./fixtures/api-stubs";

// 【临时件】分组取证（续弹窗那份）：按「组」定点截真图。
//
// 与 _audit-dialogs.spec.ts 的分工：那份靠扫描发现弹窗（组 1），这份定点截页面、面板、
// 选择器、空态（组 2～7）。产物一律落在 .verify/group-shots/（本机目录、不入 git）。
//
// 跑法：DIALOG_AUDIT=1 npx playwright test _audit-groups
// 用完即删，别留在套件里。

const OUT = path.resolve(process.cwd(), "../.verify/group-shots");
const VIEW = { width: 1440, height: 900 };

/** 空数据：工作目录、策略、技能三样都空，用来把各处「没有数据时显示什么」逼出来。 */
const EMPTY_ALL = {
  "GET /api/workdirs": [],
  "GET /api/strategies": [],
  "GET /api/skills": [],
};

/** 空数据（保留工作目录与批次）：逼出抽屉与弹窗里的空态。 */
const EMPTY_INNER = {
  "GET /api/strategies": [],
  "GET /api/skills": [],
};

const log: string[] = [];

/** 截整屏（真视口，不缩放）。 */
async function shot(page: Page, name: string): Promise<void> {
  await page.addStyleTag({
    content: "*,*::before,*::after{transition:none !important;animation:none !important}",
  });
  await page.waitForTimeout(180);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  log.push(`整屏\t${name}\t${VIEW.width}x${VIEW.height}`);
}

/** 截某个元素（不缩放，图上的像素就是它真实的像素）。 */
async function shotEl(page: Page, selector: string, name: string): Promise<boolean> {
  const box = page.locator(selector).first();
  if ((await box.count()) === 0) return false;
  try {
    await box.waitFor({ state: "visible", timeout: 3000 });
    await page.addStyleTag({
      content:
        "*,*::before,*::after{transition:none !important;animation:none !important}",
    });
    await page.waitForTimeout(160);
    const rect = await box.boundingBox();
    await box.screenshot({ path: path.join(OUT, `${name}.png`) });
    log.push(
      `元素\t${name}\t${Math.round(rect?.width ?? 0)}x${Math.round(rect?.height ?? 0)}`,
    );
    return true;
  } catch {
    return false;
  }
}

/** 复位到打标页（清本地状态再重载：应用会恢复上次所在页面与页内子状态）。 */
async function gotoLabeling(page: Page): Promise<void> {
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
  await page.waitForTimeout(400);
}

/** 打开「工作目录设置」抽屉。 */
async function openWorkdirDrawer(page: Page): Promise<void> {
  await page.getByRole("button", { name: "选择工作目录与批次" }).click();
  await page.getByRole("button", { name: /工作目录设置/ }).first().click();
  await page.waitForTimeout(500);
}

/** 进设置页的某个子页。 */
async function gotoSettings(page: Page, sub: string): Promise<void> {
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await page
    .getByRole("button", { name: "设置", exact: true })
    .click({ timeout: 8000 });
  await page.waitForTimeout(400);
  if (sub !== "端点配置") {
    await page.getByRole("button", { name: sub, exact: true }).click();
  }
  await page.waitForTimeout(500);
}

test.describe("分组取证", () => {
  test.skip(
    process.env.DIALOG_AUDIT !== "1",
    "取证用临时件：加 DIALOG_AUDIT=1 才跑",
  );
  test.setTimeout(20 * 60 * 1000);
  test.use({ actionTimeout: 6000 });

  test("组 2 · 两个「左列表 + 右详情」面板", async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    await page.setViewportSize(VIEW);
    await stubApi(page, []);
    await page.waitForFunction(() => document.fonts.status === "loaded");

    await gotoSettings(page, "端点配置");
    await shot(page, "g2-端点配置-整屏");
    await shotEl(page, "main", "g2-端点配置-双栏特写");

    await gotoSettings(page, "技能");
    await shot(page, "g2-技能-整屏");
    await shotEl(page, "main", "g2-技能-双栏特写");
  });

  test("组 3 · 两个选择器（触发器 + 展开菜单）", async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    await page.setViewportSize(VIEW);
    await stubApi(page, []);
    await page.goto("/");
    await page.waitForFunction(() => document.fonts.status === "loaded");

    // 工作台首屏（端点切换器在这里）
    await shot(page, "g7-工作台-整屏");
    await shotEl(page, '[aria-label="端点配置切换器"]', "g3-端点切换器-收起");
    await page.getByRole("button", { name: "端点配置切换器" }).click();
    await page.waitForTimeout(300);
    await shotEl(
      page,
      '[data-slot="dropdown-menu-content"], [role="menu"]',
      "g3-端点切换器-展开",
    );
    await page.keyboard.press("Escape");

    // 打标页（批次选择器在这里）
    await gotoLabeling(page);
    await shot(page, "g7-打标页-整屏");
    const sel = page.getByRole("button", { name: "选择工作目录与批次" });
    if ((await sel.count()) > 0) {
      await shotEl(page, '[aria-label="选择工作目录与批次"]', "g3-批次选择器-收起");
      await sel.click();
      await page.waitForTimeout(300);
      await shotEl(
        page,
        '[data-slot="dropdown-menu-content"], [role="menu"]',
        "g3-批次选择器-展开",
      );
      await page.keyboard.press("Escape");
    }
  });

  test("组 4 · 空数据态（六处「没有数据时显示什么」）", async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    await page.setViewportSize(VIEW);

    // 甲组：工作目录 / 策略 / 技能 全空
    await stubApi(page, [], EMPTY_ALL);
    await page.waitForFunction(() => document.fonts.status === "loaded");
    await gotoLabeling(page);
    await shot(page, "g4-打标页-无工作目录");
    const sel = page.getByRole("button", { name: "选择工作目录与批次" });
    if ((await sel.count()) > 0) {
      await sel.click();
      await page.waitForTimeout(300);
      await shotEl(
        page,
        '[data-slot="dropdown-menu-content"], [role="menu"]',
        "g4-选择器-还没有工作目录",
      );
      await page.keyboard.press("Escape");
    }

    // 乙组：有工作目录与批次，但策略与技能为空
    await stubApi(page, [], EMPTY_INNER);
    await gotoLabeling(page);
    await openWorkdirDrawer(page);
    await shot(page, "g7-工作目录设置抽屉-整屏");
    await shotEl(page, '[role="dialog"]', "g4-工作目录设置-还没有策略");

    // 抽屉里的「清理」→ 没有可清理的项目（元素截不到就退回整屏，别让取证白跑）
    const clean = page.getByRole("button", { name: "清理", exact: true });
    if ((await clean.count()) > 0) {
      await clean
        .first()
        .click({ timeout: 4000 })
        .catch(() => undefined);
      await page.waitForTimeout(700);
      const ok = await shotEl(
        page,
        '[data-slot="dialog-content"]',
        "g4-清理弹窗-没有可清理的项目",
      );
      if (!ok) await shot(page, "g4-清理弹窗-没有可清理的项目-整屏");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }

    // 抽屉里的「新增策略」→ 没有可用 Skill
    const add = page.getByRole("button", { name: /新增策略/ });
    if ((await add.count()) > 0) {
      await add
        .first()
        .click({ timeout: 4000 })
        .catch(() => undefined);
      await page.waitForTimeout(600);
      const ok = await shotEl(
        page,
        '[data-slot="dialog-content"]',
        "g4-新增策略弹窗-没有可用 Skill",
      );
      if (!ok) await shot(page, "g4-新增策略弹窗-没有可用 Skill-整屏");
      await page.keyboard.press("Escape");
    }
  });

  test("组 7 · 新建跑批：实际走一遍并截", async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    await page.setViewportSize(VIEW);
    await stubApi(page, []);
    await page.waitForFunction(() => document.fonts.status === "loaded");
    await gotoLabeling(page);

    const start = page.getByRole("button", { name: "新建跑批" });
    if ((await start.count()) === 0) return;
    await start.first().click();
    await page.waitForTimeout(600);
    await shot(page, "g7-新建跑批-第一步");

    // 表单里的三处下拉：逐一点开截图（组 3 的第三个样张来源）
    for (const label of ["提示词", "端点", "技能"]) {
      const trigger = page.getByRole("button", { name: new RegExp(label) });
      if ((await trigger.count()) > 0) {
        await trigger
          .first()
          .click({ timeout: 4000 })
          .catch(() => undefined);
        await page.waitForTimeout(300);
        await shotEl(
          page,
          '[data-slot="dropdown-menu-content"], [role="menu"], [data-slot="select-content"]',
          `g3-新建跑批-${label}下拉`,
        );
        await page.keyboard.press("Escape");
        await page.waitForTimeout(200);
      }
    }

    // 「先去导入」→ 导入素材弹窗
    const imp = page.getByRole("button", { name: "先去导入" });
    if ((await imp.count()) > 0) {
      await imp.first().click();
      await page.waitForTimeout(600);
      await shotEl(page, '[data-slot="dialog-content"]', "g7-新建跑批-导入素材弹窗");
      await shot(page, "g7-新建跑批-导入素材-整屏");
      await page.keyboard.press("Escape");
    }
  });

  test("组 7 · 服务运行与批次概览、导出", async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    await page.setViewportSize(VIEW);
    await stubApi(page, []);
    await page.goto("/");
    await page.waitForFunction(() => document.fonts.status === "loaded");

    await gotoSettings(page, "服务运行");
    await shot(page, "g7-设置-服务运行-整屏");

    await gotoLabeling(page);
    // 批次概览：先展开（点「校验素材完整性」逼出报告区），再截
    const check = page.getByRole("button", { name: /校验素材完整性/ });
    if ((await check.count()) > 0) {
      await check.first().click();
      await page.waitForTimeout(900);
      await shot(page, "g7-批次概览-展开后");
      const rebuild = page.getByRole("button", { name: "重建导入记录" });
      if ((await rebuild.count()) > 0) {
        await rebuild.first().click();
        await page.waitForTimeout(600);
        await shotEl(page, '[data-slot="dialog-content"]', "g7-重建导入记录");
        await page.keyboard.press("Escape");
      }
    }
    await shot(page, "g7-批次概览-整屏");
  });
});

test.afterAll(() => {
  if (log.length) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(path.join(OUT, "shots.tsv"), `${log.join("\n")}\n`, "utf8");
    console.log("\n===== 取证清单 =====");
    for (const line of log) console.log(line);
  }
});
