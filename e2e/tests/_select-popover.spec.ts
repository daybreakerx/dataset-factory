import { test } from "@playwright/test";

// 表单 Select 弹层取证（SPC_*，2026-09-30 立件）——稿侧「通用件/下拉选择器.html」三侧取证的实现侧翼补缺：
// 此前实现侧值全部来自 select.tsx 类名读取、从未开弹层实测（取证缺口，2026-09-29 定「过此件时补」）。
// 身份：四件取证常备件之一（env-gate 门内默认 skip，不进 CI——同 _compare-capture／_audit-* 口径）；
// 长期常备、不专门回收；大重构开工前与收口复核各复跑一次。
// 跑法：cd workspace/e2e && NO_PROXY='*' SELECT_PROBE=1 npx playwright test _select-popover

test("measure select popover computed styles", async ({ page }) => {
  if (!process.env.SELECT_PROBE) test.skip(true, "专项取证：SELECT_PROBE=1 才跑");
  test.setTimeout(120_000);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();

  // 造数（幂等）：与 EPC 块同口径——按名补缺两套端点（本件量弹层，与端点激活机制无关）
  const setup = await page.evaluate(async () => {
    const eps: Array<{ id: string; name: string }> = await (await fetch("/api/endpoints")).json();
    const names = new Set(eps.map((e) => e.name));
    const seed: Array<Record<string, string>> = [];
    if (!names.has("SiliconFlow")) {
      seed.push({
        name: "SiliconFlow",
        base_url: "https://api.siliconflow.cn/v1",
        model: "Qwen/Qwen3.5-4B",
        api_key: "sk-probe-noop", // pragma: allowlist secret — 取证造数用假密钥（同 EPC 块口径）
        api_format: "openai-chat-completions",
      });
    }
    for (const body of seed) {
      await fetch("/api/endpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    const final = await (await fetch("/api/endpoints")).json();
    return { count: final.length, names: final.map((e: { name: string }) => e.name) };
  });
  console.log("SPC_SETUP:", JSON.stringify(setup));
  await page.reload();

  const gotoSettings = async (): Promise<void> => {
    const back = page.getByRole("button", { name: "返回工作区" });
    if (await back.isVisible().catch(() => false)) {
      await back.click();
      await page.waitForTimeout(200);
    }
    await page.getByRole("button", { name: "策略", exact: true }).click();
    await page.getByRole("textbox").first().waitFor({ state: "visible", timeout: 10_000 });
    await page.getByTestId("sidebar").getByRole("button", { name: "设置", exact: true }).click();
  };
  await gotoSettings();
  await page.getByRole("heading", { name: "端点配置" }).first().waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(300);

  // 触发件（API 格式）
  console.log("SPC_TRIGGER:", JSON.stringify(await page.evaluate(() => {
    const trig = document.querySelector('[data-slot="select-trigger"]');
    if (!trig) return null;
    const cs = getComputedStyle(trig);
    const svg = trig.querySelector("svg");
    const r = trig.getBoundingClientRect();
    return {
      h: trig.offsetHeight, w: r.width, radius: cs.borderRadius,
      bd: cs.borderTopWidth + " " + cs.borderTopColor, bg: cs.backgroundColor,
      size: cs.fontSize, color: cs.color, pad: cs.padding,
      chev: svg ? getComputedStyle(svg).width + "/" + getComputedStyle(svg).height + "/" + getComputedStyle(svg).color : null,
    };
  }), null, 2));

  // 开弹层：先抓动画首帧信息（click 返回即量），再等稳态
  await page.locator('[data-slot="select-trigger"]').first().click();
  const anim = await page.evaluate(() => {
    const c = document.querySelector('[data-slot="select-content"]');
    if (!c) return null;
    const cs = getComputedStyle(c);
    return { animationName: cs.animationName, duration: cs.animationDuration, timing: cs.animationTimingFunction.slice(0, 30), transform: cs.transform };
  });
  console.log("SPC_ANIM:", JSON.stringify(anim));
  await page.waitForTimeout(400);

  // 弹层盒 + 视口（Viewport）
  console.log("SPC_POP:", JSON.stringify(await page.evaluate(() => {
    const c = document.querySelector('[data-slot="select-content"]');
    const trig = document.querySelector('[data-slot="select-trigger"]');
    if (!c || !trig) return null;
    const g = getComputedStyle(c);
    const vp = c.querySelector('[data-radix-popper-content-wrapper]') ?? c;
    const cr = c.getBoundingClientRect();
    const tr = trig.getBoundingClientRect();
    return {
      w: cr.width, h: cr.height, trigW: tr.width, trigBottom: tr.bottom, popTop: cr.top, gap: cr.top - tr.bottom,
      radius: g.borderRadius, bd: g.borderTopWidth + " " + g.borderTopColor, bg: g.backgroundColor,
      shadow: g.boxShadow, overflow: g.overflow, contentW: g.width, minWidth: g.minWidth, maxWidth: g.maxWidth,
      wrapperPos: getComputedStyle(vp.parentElement ?? vp).position,
    };
  }), null, 2));
  console.log("SPC_VIEWPORT:", JSON.stringify(await page.evaluate(() => {
    const c = document.querySelector('[data-slot="select-content"]');
    const vp = c?.querySelector("div[data-radix-select-viewport]");
    if (!vp) return null;
    const g = getComputedStyle(vp);
    return { pad: g.padding, w: g.width, minWidth: g.minWidth };
  }), null, 2));

  // 行 + 当前行（打开即量：Radix 打开时焦点落当前项——focus 底色叠加，如实记录）
  console.log("SPC_ROWS_FOCUS_STATE:", JSON.stringify(await page.evaluate(() => {
    const c = document.querySelector('[data-slot="select-content"]');
    if (!c) return null;
    const g = (el: HTMLElement) => getComputedStyle(el);
    return Array.from(c.querySelectorAll('[data-radix-select-item], [data-radix-collection-item]')).map((it) => {
      const el = it as HTMLElement;
      const cs = g(el);
      return {
        text: el.textContent?.slice(0, 26),
        state: el.getAttribute("data-state"), disabled: el.getAttribute("data-disabled"),
        focused: el === document.activeElement,
        bg: cs.backgroundColor, bd: cs.borderTopWidth + " " + cs.borderTopColor,
        radius: cs.borderRadius, pad: cs.padding,
        size: cs.fontSize, weight: cs.fontWeight, color: cs.color, lineH: cs.lineHeight,
      };
    });
  }), null, 2));
  console.log("SPC_CHECK:", JSON.stringify(await page.evaluate(() => {
    const cur = document.querySelector('[data-slot="select-content"] [data-state="checked"]');
    if (!cur) return null;
    const wrap = cur.querySelector("span.absolute");
    const svg = wrap?.querySelector("svg");
    return {
      wrapPresent: !!wrap, wrapSize: wrap ? getComputedStyle(wrap).width : null,
      wrapRight: wrap ? getComputedStyle(wrap).right : null,
      svgPresent: !!svg, svgSize: svg ? getComputedStyle(svg).width : null,
      svgColor: svg ? getComputedStyle(svg).color : null,
      svgVisible: svg ? svg.checkVisibility() : null,
    };
  }), null, 2));

  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  const closed = await page.evaluate(() => !document.querySelector('[data-slot="select-content"]'));
  console.log("SPC_ESC_CLOSE:", JSON.stringify({ closed }));

  // 思考模式弹层（先展开高级参数）：三行可用 → ArrowDown 移开焦点，量「纯 checked 态」（无 focus 叠加）
  await page.getByRole("button", { name: /高级参数/ }).click();
  await page.waitForTimeout(300);
  console.log("SPC_THINK_TRIGGER:", JSON.stringify(await page.evaluate(() => {
    const trig = document.querySelector("#adv-thinking");
    if (!trig) return null;
    const r = trig.getBoundingClientRect();
    const cs = getComputedStyle(trig);
    return { w: r.width, h: trig.offsetHeight, radius: cs.borderRadius, size: cs.fontSize };
  }), null, 2));
  await page.locator("#adv-thinking").click();
  await page.waitForTimeout(400);
  console.log("SPC_THINK_POP:", JSON.stringify(await page.evaluate(() => {
    const c = document.querySelector('[data-slot="select-content"]');
    const trig = document.querySelector("#adv-thinking");
    if (!c || !trig) return null;
    const g = getComputedStyle(c);
    return {
      popW: c.getBoundingClientRect().width, trigW: trig.getBoundingClientRect().width,
      shadow: g.boxShadow.slice(0, 80), radius: g.borderRadius,
    };
  }), null, 2));
  console.log("SPC_THINK_ROWS:", JSON.stringify(await page.evaluate(() => {
    const c = document.querySelector('[data-slot="select-content"]');
    if (!c) return null;
    const g = (el: HTMLElement) => getComputedStyle(el);
    return Array.from(c.querySelectorAll("[data-radix-collection-item]")).map((it) => {
      const el = it as HTMLElement;
      const cs = g(el);
      return {
        text: el.textContent?.slice(0, 20), state: el.getAttribute("data-state"),
        focused: el === document.activeElement,
        bg: cs.backgroundColor, bd: cs.borderTopWidth + " " + cs.borderTopColor,
        weight: cs.fontWeight, color: cs.color,
      };
    });
  }), null, 2));
  // ArrowDown 移开焦点（思考弹层后两行可用，焦点会落到「开启思考」）
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(200);
  console.log("SPC_THINK_CUR_PURE:", JSON.stringify(await page.evaluate(() => {
    const cur = document.querySelector('[data-slot="select-content"] [data-state="checked"]');
    if (!cur) return null;
    const cs = getComputedStyle(cur as HTMLElement);
    const wrap = (cur as HTMLElement).querySelector("span.absolute");
    return {
      focused: cur === document.activeElement,
      bg: cs.backgroundColor, bd: cs.borderTopWidth + " " + cs.borderTopColor,
      color: cs.color, weight: cs.fontWeight,
      checkWrapPresent: !!wrap, svgPresent: !!wrap?.querySelector("svg"),
    };
  }), null, 2));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: /高级参数/ }).click();

  // 暗色重跑关键项
  await page.evaluate(() => localStorage.setItem("dsf-theme", "dark"));
  await page.reload();
  await gotoSettings();
  await page.waitForTimeout(500);
  await page.locator('[data-slot="select-trigger"]').first().click();
  await page.waitForTimeout(400);
  console.log("SPC_DARK:", JSON.stringify(await page.evaluate(() => {
    const c = document.querySelector('[data-slot="select-content"]');
    if (!c) return null;
    const g = getComputedStyle(c);
    const cur = c.querySelector('[data-state="checked"]') as HTMLElement | null;
    const dis = c.querySelector("[data-disabled]") as HTMLElement | null;
    const svg = cur?.querySelector("span.absolute svg");
    return {
      popBg: g.backgroundColor, popBd: g.borderTopColor, shadow: g.boxShadow,
      curBg: cur ? getComputedStyle(cur).backgroundColor : null,
      curColor: cur ? getComputedStyle(cur).color : null,
      disColor: dis ? getComputedStyle(dis).color : null,
      svgColor: svg ? getComputedStyle(svg).color : null,
    };
  }), null, 2));
  await page.keyboard.press("Escape");
});
