import { test } from "@playwright/test";

// 零件取证 · 发送钮 computed style 实测（默认跳过，CMP_CAPTURE=1 才跑）
test.skip(!process.env.CMP_CAPTURE, "取证专用：CMP_CAPTURE=1 才跑");

test("measure send-button computed style", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "策略", exact: true }).click();
  await page.getByRole("textbox").first().waitFor({ state: "visible", timeout: 10_000 });
  const send = page.getByRole("button", { name: "发送", exact: true });
  await send.waitFor({ state: "visible", timeout: 10_000 });
  const m = await send.evaluate((el) => {
    const cs = getComputedStyle(el);
    const svg = el.querySelector("svg");
    const scs = svg ? getComputedStyle(svg) : null;
    return {
      width: cs.width,
      height: cs.height,
      borderRadius: cs.borderRadius,
      background: cs.backgroundColor,
      color: cs.color,
      disabledOpacity: cs.opacity,
      svgWidth: scs?.width,
      svgStroke: scs?.strokeWidth,
      fontFamilyHint: cs.fontSize,
    };
  });
  console.log("SEND_BTN:", JSON.stringify(m, null, 2));
});

// 零件取证 · 保存钮 computed style 实测（同一 CMP_CAPTURE=1 门）
// 三态：可保存（脏） / 禁用·无改动 / 禁用·超预算；策略行与提示词行各测干净态，脏态抽查。
const SAVE_PROPS = (el: HTMLElement): Record<string, string> => {
  const cs = getComputedStyle(el);
  return {
    className: el.className,
    disabled: String((el as HTMLButtonElement).disabled),
    width: cs.width,
    height: cs.height,
    paddingLeft: cs.paddingLeft,
    paddingRight: cs.paddingRight,
    borderRadius: cs.borderRadius,
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    backgroundColor: cs.backgroundColor,
    color: cs.color,
    opacity: cs.opacity,
    borderWidth: cs.borderTopWidth,
    transitionProperty: cs.transitionProperty,
    transform: cs.transform,
  };
};

test("measure save-button computed styles", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await page.getByRole("button", { name: "策略", exact: true }).click();
  await page.getByRole("textbox").first().waitFor({ state: "visible", timeout: 10_000 });

  const savePrompt = page.getByRole("button", { name: "保存", exact: true });
  const saveStrategy = page.getByRole("button", { name: "保存策略" });
  await savePrompt.waitFor({ state: "visible", timeout: 10_000 });
  await saveStrategy.waitFor({ state: "visible", timeout: 10_000 });

  // ① 提示词行 · 干净态（ghost + 禁用）
  console.log("SAVE_PROMPT_CLEAN:", JSON.stringify(await savePrompt.evaluate(SAVE_PROPS), null, 2));
  // ② 策略行 · 干净态
  console.log("SAVE_STRATEGY_CLEAN:", JSON.stringify(await saveStrategy.evaluate(SAVE_PROPS), null, 2));

  // ③ 提示词行 · 脏态（default + 可用）：hover 与按压缩放实测
  await page.getByLabel("描述", { exact: true }).fill("取证修改描述");
  await page.waitForTimeout(300);
  console.log("SAVE_PROMPT_DIRTY:", JSON.stringify(await savePrompt.evaluate(SAVE_PROPS), null, 2));
  await savePrompt.hover();
  await page.waitForTimeout(200);
  const dirtyHover = await savePrompt.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { hoverBackgroundColor: cs.backgroundColor, hoverColor: cs.color };
  });
  console.log("SAVE_PROMPT_DIRTY_HOVER:", JSON.stringify(dirtyHover, null, 2));
  const box = await savePrompt.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(150);
    const dirtyActive = await savePrompt.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { activeBackgroundColor: cs.backgroundColor, activeTransform: cs.transform };
    });
    console.log("SAVE_PROMPT_DIRTY_ACTIVE:", JSON.stringify(dirtyActive, null, 2));
    await page.mouse.move(5, 5);
    await page.mouse.up();
  }

  // ④ 策略行 · 脏态（抽查：与提示词行同组件应同值）
  await page.getByLabel("策略描述").fill("取证修改策略描述");
  await page.waitForTimeout(300);
  console.log("SAVE_STRATEGY_DIRTY:", JSON.stringify(await saveStrategy.evaluate(SAVE_PROPS), null, 2));

  // ⑤ 提示词行 · 超预算禁用（dirty 成立 → default 变禁用灰）
  await page.getByLabel("正文（Markdown）").fill("字".repeat(33_000));
  await page.waitForTimeout(300);
  console.log("SAVE_PROMPT_OVER:", JSON.stringify(await savePrompt.evaluate(SAVE_PROPS), null, 2));
});
