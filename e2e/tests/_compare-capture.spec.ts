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
