import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

// 零件取证 · 策略下拉 computed style 实测（同一 CMP_CAPTURE=1 门）
// 触发件（名字输入框 hover/focus + 箭头钮）→ 弹层（面板/头行/新建钮）→ 行（当前/普通/坏/hover）→ 锁定提示。
// 坏行 = API 建一条策略再删其引用提示词（数据根是本次运行新建的临时根，删了无碍）。
const BOX = (el: HTMLElement): Record<string, string | number> => {
  const cs = getComputedStyle(el);
  return {
    width: el.offsetWidth, height: el.offsetHeight,
    paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight,
    paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom,
    borderRadius: cs.borderRadius,
    backgroundColor: cs.backgroundColor,
    color: cs.color,
    fontSize: cs.fontSize, fontWeight: cs.fontWeight,
    borderTopWidth: cs.borderTopWidth, borderTopColor: cs.borderTopColor,
    boxShadow: cs.boxShadow === "none" ? "none" : "(has shadow)",
    opacity: cs.opacity,
  };
};
const TXT = (el: HTMLElement): Record<string, string | number> => {
  const cs = getComputedStyle(el);
  return {
    text: (el.textContent ?? "").slice(0, 12),
    offsetLeft: el.offsetLeft, offsetTop: el.offsetTop, offsetWidth: el.offsetWidth,
    fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color,
  };
};

test("measure strategy-dropdown computed styles", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();

  // 造两行：正常策略（引用种子提示词）＋ 坏行（自建临时提示词供其引用，建完即删→引用悬空）；种子数据零触碰
  const badRowSetup = await page.evaluate(async () => {
    const eps: Array<{ id: string }> = await (await fetch("/api/endpoints")).json();
    const ps: Array<{ id: string }> = await (await fetch("/api/prompts")).json();
    if (eps.length === 0 || ps.length === 0) return { ok: false, why: "no seed" };
    const pc = await fetch("/api/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "取证·临时提示词", description: "取证用", body: "占位正文" }),
    });
    if (!pc.ok) return { ok: false, stage: "prompt", status: pc.status };
    const tmp = (await pc.json()) as { id: string };
    const mk = (name: string, promptId: string) =>
      fetch("/api/strategies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: "取证用策略描述文本", endpoint_id: eps[0].id, prompt_id: promptId, skill_ids: [] }),
      }).then(async (r) => ({ ok: r.ok, status: r.status, body: r.ok ? null : await r.text() }));
    const good = await mk("取证·正常策略", ps[0].id);
    const bad = await mk("取证·引用悬空", tmp.id);
    if (!good.ok || !bad.ok) return { ok: false, stage: "strategy", good, bad };
    const del = await fetch("/api/prompts/" + tmp.id, { method: "DELETE" });
    return { ok: del.ok, goodStatus: good.status, badStatus: bad.status, deletedPromptStatus: del.status };
  });
  console.log("BADROW_SETUP:", JSON.stringify(badRowSetup));
  await page.reload();
  await page.getByRole("button", { name: "策略", exact: true }).click();
  const nameInput = page.getByLabel("策略名称");
  await nameInput.waitFor({ state: "visible", timeout: 10_000 });

  // 触发件：名字输入框
  console.log("STRAT_TRIGGER:", JSON.stringify(await nameInput.evaluate(BOX), null, 2));
  await nameInput.hover();
  await page.waitForTimeout(200);
  console.log("STRAT_TRIGGER_HOVER:", JSON.stringify(await nameInput.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { borderTopColor: cs.borderTopColor, backgroundColor: cs.backgroundColor };
  }), null, 2));
  await nameInput.focus();
  await page.waitForTimeout(200);
  console.log("STRAT_TRIGGER_FOCUS:", JSON.stringify(await nameInput.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { borderTopColor: cs.borderTopColor, backgroundColor: cs.backgroundColor, outlineWidth: cs.outlineWidth };
  }), null, 2));
  const chev = page.getByRole("button", { name: "切换策略" });
  console.log("STRAT_CHEVRON:", JSON.stringify(await chev.evaluate(BOX), null, 2));

  // 打开下拉；挪开鼠标防悬停污染、等入场动画落定
  await chev.click();
  const menu = page.getByRole("menu");
  await menu.waitFor({ state: "visible", timeout: 5000 });
  await page.mouse.move(10, 500);
  await page.waitForTimeout(400);
  console.log("STRAT_PANEL:", JSON.stringify(await menu.evaluate(BOX), null, 2));
  const headRow = menu.locator("div").filter({ hasText: "策略库 · 共" }).first();
  console.log("STRAT_HEAD:", JSON.stringify(await headRow.evaluate(BOX), null, 2));
  const addBtn = menu.getByRole("button", { name: "新建策略" });
  console.log("STRAT_ADD:", JSON.stringify(await addBtn.evaluate(BOX), null, 2));
  const goodRow = menu.locator("div.group").filter({ hasText: "取证·正常策略" });
  const badRowLoc = menu.locator("div.group").filter({ hasText: "引用缺失" });
  console.log("STRAT_ROWS_COUNT:", JSON.stringify({ good: await goodRow.count(), bad: await badRowLoc.count() }));
  const normalRow = goodRow.first();
  console.log("STRAT_ROW_NORMAL:", JSON.stringify(await normalRow.evaluate(BOX), null, 2));
  const normalName = normalRow.locator("span.text-t-md").first();
  console.log("STRAT_ROW_NAME:", JSON.stringify(await normalName.evaluate(TXT), null, 2));
  const normalWcount = normalRow.locator("span.shrink-0").first();
  console.log("STRAT_ROW_WCOUNT:", JSON.stringify(await normalWcount.evaluate(TXT), null, 2));
  const normalDesc = normalRow.locator("span.truncate.text-t-xs").first();
  console.log("STRAT_ROW_DESC:", JSON.stringify(await normalDesc.evaluate(TXT), null, 2));
  const rowIcon = normalRow.getByRole("button").nth(1);
  console.log("STRAT_ROW_ICON:", JSON.stringify(await rowIcon.evaluate(BOX), null, 2));
  await normalRow.hover();
  await page.waitForTimeout(150);
  console.log("STRAT_ROW_HOVER:", JSON.stringify(await normalRow.evaluate((el) => {
    return { backgroundColor: getComputedStyle(el).backgroundColor };
  }), null, 2));

  // 选中正常行（当前态）→ 重开量当前行与坏行
  await normalRow.locator("button").first().click();
  await menu.waitFor({ state: "hidden", timeout: 5000 });
  await chev.click();
  await menu.waitFor({ state: "visible", timeout: 5000 });
  await page.mouse.move(10, 500);
  await page.waitForTimeout(400);
  const curRow = goodRow.first();
  console.log("STRAT_ROW_CURRENT:", JSON.stringify(await curRow.evaluate(BOX), null, 2));
  const curName = curRow.locator("span.text-t-md").first();
  console.log("STRAT_ROW_CUR_NAME:", JSON.stringify(await curName.evaluate(TXT), null, 2));
  if ((await badRowLoc.count()) > 0) {
    console.log("STRAT_ROW_BAD:", JSON.stringify(await badRowLoc.first().evaluate(BOX), null, 2));
    const badName = badRowLoc.first().locator("span.text-t-md").first();
    console.log("STRAT_BAD_NAME:", JSON.stringify(await badName.evaluate(TXT), null, 2));
    const badText = badRowLoc.first().locator("span.text-bad-ink").first();
    console.log("STRAT_BAD_TEXT:", JSON.stringify(await badText.evaluate(TXT), null, 2));
  } else {
    console.log("STRAT_ROW_BAD:", JSON.stringify({ absent: true }));
  }

  // 锁定提示：脏着点另一行（坏行）
  await page.keyboard.press("Escape");
  await page.getByLabel("策略描述").fill("取证改描述触发锁定");
  await chev.click();
  await menu.waitFor({ state: "visible", timeout: 5000 });
  await badRowLoc.first().locator("button").first().click();
  await page.waitForTimeout(300);
  const notice = page.locator('[role="status"]').last();
  if ((await notice.count()) > 0) {
    console.log("STRAT_NOTICE:", JSON.stringify(await notice.evaluate(BOX), null, 2));
  } else {
    console.log("STRAT_NOTICE:", JSON.stringify({ absent: true }));
  }
});

// 零件取证 · 提示词场景下拉（select-scene）computed style 实测（同一 CMP_CAPTURE=1 门）
// 触发件（名字输入框 hover/focus + 箭头钮 + 脏态禁用）→ 弹层（面板/头行/新建钮）→ 行（当前语义行/普通/hover/删除钮）。
// 数据 = API 自建两条提示词（数据根本次运行新建，零种子触碰）；进页自动选中首条，首行即「当前」语义行。
const SCENE_BOX = (el: HTMLElement): Record<string, string | number> => {
  const cs = getComputedStyle(el);
  return {
    width: el.offsetWidth, height: el.offsetHeight,
    minWidth: cs.minWidth,
    paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight,
    paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom,
    borderRadius: cs.borderRadius,
    backgroundColor: cs.backgroundColor,
    color: cs.color,
    fontSize: cs.fontSize, fontWeight: cs.fontWeight, lineHeight: cs.lineHeight,
    borderTopWidth: cs.borderTopWidth, borderTopColor: cs.borderTopColor,
    boxShadow: cs.boxShadow,
    opacity: cs.opacity,
  };
};

test("measure prompt-dropdown computed styles", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });

  const setup = await page.evaluate(async () => {
    const mk = (name: string, desc: string) =>
      fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: desc, body: "取证正文：" + name }),
      }).then(async (r) => ({ ok: r.ok, status: r.status, body: r.ok ? null : await r.text() }));
    const a = await mk("取证·场景甲", "三到五句自然连贯的详细描述，覆盖主体、动作与光影。");
    const b = await mk("取证·场景乙", "逗号分隔的标签短语，训练快但信息量少。");
    return { a, b };
  });
  console.log("SCENE_SETUP:", JSON.stringify(setup));
  await page.reload();
  await page.getByRole("button", { name: "策略", exact: true }).click();
  const nameInput = page.getByLabel("名称", { exact: true });
  await nameInput.waitFor({ state: "visible", timeout: 10_000 });

  // 触发件：名字输入框（静置 / hover / focus；focus 额外看 outlineStyle——#13 口径 = 打字框无环）
  console.log("SCENE_TRIGGER:", JSON.stringify(await nameInput.evaluate(SCENE_BOX), null, 2));
  await nameInput.hover();
  await page.waitForTimeout(200);
  console.log("SCENE_TRIGGER_HOVER:", JSON.stringify(await nameInput.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { borderTopColor: cs.borderTopColor, backgroundColor: cs.backgroundColor };
  }), null, 2));
  await nameInput.focus();
  await page.waitForTimeout(200);
  console.log("SCENE_TRIGGER_FOCUS:", JSON.stringify(await nameInput.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { borderTopColor: cs.borderTopColor, backgroundColor: cs.backgroundColor, outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth };
  }), null, 2));
  await page.mouse.move(10, 500);
  await page.waitForTimeout(200);

  // 箭头钮（干净态可点）
  const chev = page.getByRole("button", { name: "切换提示词" });
  console.log("SCENE_CHEVRON:", JSON.stringify(await chev.evaluate(SCENE_BOX), null, 2));

  // 打开弹层；挪开鼠标防悬停污染、等入场动画落定
  await chev.click();
  const menu = page.getByRole("menu");
  await menu.waitFor({ state: "visible", timeout: 5000 });
  await page.mouse.move(10, 500);
  await page.waitForTimeout(400);
  console.log("SCENE_PANEL:", JSON.stringify(await menu.evaluate(SCENE_BOX), null, 2));
  const headRow = menu.locator("div").filter({ hasText: "提示词库 · 共" }).first();
  console.log("SCENE_HEAD:", JSON.stringify(await headRow.evaluate(SCENE_BOX), null, 2));
  console.log("SCENE_HEAD_LABEL:", JSON.stringify(await headRow.locator("span").first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { text: (el.textContent ?? "").slice(0, 16), fontSize: cs.fontSize, color: cs.color };
  }), null, 2));
  const addBtn = menu.getByRole("button", { name: "新建提示词" });
  console.log("SCENE_ADD:", JSON.stringify(await addBtn.evaluate(SCENE_BOX), null, 2));

  const rows = menu.locator("div.max-h-80 > div");
  console.log("SCENE_ROWS_COUNT:", JSON.stringify({ count: await rows.count() }));
  const row1 = rows.first();   // 首条 = 当前选中（实现侧无当前行样式，实测验证）
  console.log("SCENE_ROW_FIRST:", JSON.stringify(await row1.evaluate(SCENE_BOX), null, 2));
  console.log("SCENE_ROW_NAME:", JSON.stringify(await row1.locator("span.text-t-md").first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { text: (el.textContent ?? "").slice(0, 12), fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color };
  }), null, 2));
  console.log("SCENE_ROW_DESC:", JSON.stringify(await row1.locator("span.text-t-xs").first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { text: (el.textContent ?? "").slice(0, 12), fontSize: cs.fontSize, color: cs.color };
  }), null, 2));
  const rowDel = row1.getByRole("button", { name: /删除提示词/ });
  console.log("SCENE_ROW_DELETE:", JSON.stringify(await rowDel.evaluate(SCENE_BOX), null, 2));
  console.log("SCENE_ROW_DELETE_ICON:", JSON.stringify(await rowDel.evaluate((el) => {
    const svg = el.querySelector("svg");
    return svg ? { width: getComputedStyle(svg).width, height: getComputedStyle(svg).height, color: getComputedStyle(svg).color } : {};
  }), null, 2));
  await row1.hover();
  await page.waitForTimeout(150);
  console.log("SCENE_ROW_HOVER:", JSON.stringify(await row1.evaluate((el) => {
    return { backgroundColor: getComputedStyle(el).backgroundColor };
  }), null, 2));
  await page.mouse.move(10, 500);
  await page.waitForTimeout(150);

  // 弹层位置（默认方向与间距）
  const pos = await page.evaluate(() => {
    const menu = document.querySelector('[role="menu"]');
    const trigger = document.querySelector('[aria-label="切换提示词"]');
    if (!menu || !trigger) return {};
    const m = menu.getBoundingClientRect();
    const t = trigger.getBoundingClientRect();
    return { menuTop: Math.round(m.top), triggerBottom: Math.round(t.bottom), gap: Math.round(m.top - t.bottom), alignLeft: Math.round(m.left), triggerLeft: Math.round(t.left) };
  });
  console.log("SCENE_PANEL_POS:", JSON.stringify(pos, null, 2));

  // 关闭弹层 → 制造脏态 → 箭头钮禁用行为（以实现为准的逻辑事实；顺带核保存钮 Tip 存在）
  await page.keyboard.press("Escape");
  await page.getByLabel("描述", { exact: true }).fill("取证修改描述");
  await page.waitForTimeout(300);
  console.log("SCENE_CHEV_DIRTY:", JSON.stringify(await chev.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { disabled: String((el as HTMLButtonElement).disabled), backgroundColor: cs.backgroundColor, color: cs.color, opacity: cs.opacity };
  }), null, 2));
});

// 零件取证 · 悬停说明（Tip）computed style 实测（同一 CMP_CAPTURE=1 门）
// 触发件 = 策略行箭头钮（Tip「切换策略」）；量气泡形态与相对触发件的位置。
test("measure tooltip computed styles", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();
  await page.getByRole("button", { name: "策略", exact: true }).click();
  const chev = page.getByRole("button", { name: "切换策略" });
  await chev.waitFor({ state: "visible", timeout: 10_000 });
  await chev.hover();
  const tip = page.locator('[data-slot="tooltip-content"]');
  await tip.waitFor({ state: "visible", timeout: 5000 });
  await page.waitForTimeout(500);
  console.log("TIP_BUBBLE:", JSON.stringify(await tip.evaluate((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      width: el.offsetWidth, height: el.offsetHeight,
      paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight,
      paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom,
      borderRadius: cs.borderRadius,
      backgroundColor: cs.backgroundColor,
      color: cs.color,
      fontSize: cs.fontSize, fontWeight: cs.fontWeight, lineHeight: cs.lineHeight,
      borderTopWidth: cs.borderTopWidth, borderTopColor: cs.borderTopColor,
      boxShadow: cs.boxShadow,
      maxWidth: cs.maxWidth,
      opacity: cs.opacity,
      rectTop: Math.round(r.top), rectLeft: Math.round(r.left),
    };
  }), null, 2));
  const box = await chev.boundingBox();
  console.log("TIP_TRIGGER_BOX:", JSON.stringify({ top: Math.round(box.y), bottom: Math.round(box.y + box.height), left: Math.round(box.x), width: Math.round(box.width) }));
});

// 零件取证 · 端点切换器（select-endpoint）computed style 实测（同一 CMP_CAPTURE=1 门）
// 触发件（ghost 按钮：状态点＋「名字 · 模型」＋箭头）→ 弹层（面板/头行标签/行/active 点/分隔线/管理项）。
// 数据 = 数据根种子端点 ＋ API 补建第二条（保证「当前＋普通」两行）；种子零触碰（不足两条才建）。
test("measure endpoint-switcher computed styles", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();

  const setup = await page.evaluate(async () => {
    const eps: Array<{ id: string; name: string }> = await (await fetch("/api/endpoints")).json();
    let created: { status: number } | null = null;
    if (eps.length < 2) {
      const r = await fetch("/api/endpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "取证·备用端点",
          base_url: "https://example.invalid/v1",
          model: "probe-model",
          api_key: "sk-probe-noop", // pragma: allowlist secret — 取证造数用假密钥，指向 example.invalid 不可达地址
          api_format: "openai-chat-completions",
        }),
      });
      created = { status: r.status };
    }
    return { count: eps.length, created };
  });
  console.log("EP_SETUP:", JSON.stringify(setup));
  await page.reload();

  const trigger = page.getByRole("button", { name: "端点配置切换器" });
  await trigger.waitFor({ state: "visible", timeout: 10_000 });
  console.log("EP_TRIGGER:", JSON.stringify(await trigger.evaluate(SCENE_BOX), null, 2));
  console.log("EP_TRIGGER_DOT:", JSON.stringify(await trigger.locator("span.rounded-full").first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { width: cs.width, height: cs.height, backgroundColor: cs.backgroundColor, borderRadius: cs.borderRadius };
  }), null, 2));
  console.log("EP_TRIGGER_TEXT:", JSON.stringify(await trigger.locator("span.truncate").evaluate(TXT), null, 2));
  console.log("EP_TRIGGER_CHEV:", JSON.stringify(await trigger.locator("svg").evaluate((el) => {
    const cs = getComputedStyle(el);
    return { width: cs.width, height: cs.height, color: cs.color };
  }), null, 2));
  await trigger.hover();
  await page.waitForTimeout(200);
  console.log("EP_TRIGGER_HOVER:", JSON.stringify(await trigger.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { backgroundColor: cs.backgroundColor, color: cs.color };
  }), null, 2));

  // 打开弹层；挪开鼠标防悬停污染、等入场动画落定
  await page.mouse.move(10, 500);
  await trigger.click();
  const menu = page.getByRole("menu");
  await menu.waitFor({ state: "visible", timeout: 5000 });
  await page.mouse.move(10, 500);
  await page.waitForTimeout(400);
  console.log("EP_PANEL:", JSON.stringify(await menu.evaluate(SCENE_BOX), null, 2));
  console.log("EP_PANEL_POS:", JSON.stringify(await page.evaluate(() => {
    const menus = Array.from(document.querySelectorAll('[role="menu"]'));
    const m = menus[menus.length - 1].getBoundingClientRect();
    const t = Array.from(document.querySelectorAll('button[aria-label="端点配置切换器"]')).pop()!.getBoundingClientRect();
    return { popLeft: Math.round(m.left), popRight: Math.round(m.right), popTop: Math.round(m.top), chipLeft: Math.round(t.left), chipRight: Math.round(t.right), chipBottom: Math.round(t.bottom), align: Math.abs(m.right - t.right) < 2 ? "right" : (Math.abs(m.left - t.left) < 2 ? "left" : "other") };
  }), null, 2));

  const headLabel = menu.locator("div").filter({ hasText: "端点配置（当前使用）" }).last();
  console.log("EP_HEAD_LABEL:", JSON.stringify(await headLabel.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { text: (el.textContent ?? "").slice(0, 20), fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color, paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom };
  }), null, 2));

  const items = menu.getByRole("menuitem");
  console.log("EP_ITEMS_COUNT:", JSON.stringify({ count: await items.count() }));
  // active 行 = 带 active 点（size-2 圆点）的行；管理项 = 「管理配置」
  const activeDot = menu.locator("span.size-2.rounded-full");
  console.log("EP_ACTIVE_DOT:", JSON.stringify(await activeDot.first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { width: cs.width, height: cs.height, backgroundColor: cs.backgroundColor, borderRadius: cs.borderRadius };
  }), null, 2));
  const activeRow = menu.getByRole("menuitem").filter({ has: page.locator("span.size-2") }).first();
  console.log("EP_ROW_ACTIVE:", JSON.stringify(await activeRow.evaluate(SCENE_BOX), null, 2));
  console.log("EP_ROW_ACTIVE_TEXT:", JSON.stringify(await activeRow.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { text: (el.textContent ?? "").slice(0, 30), fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color };
  }), null, 2));
  const manageItem = menu.getByRole("menuitem", { name: "管理配置…" });
  console.log("EP_ROW_MANAGE:", JSON.stringify(await manageItem.evaluate(SCENE_BOX), null, 2));
  const sep = menu.locator('[role="separator"]');
  if ((await sep.count()) > 0) {
    console.log("EP_SEPARATOR:", JSON.stringify(await sep.first().evaluate((el) => {
      const cs = getComputedStyle(el);
      return { height: el.offsetHeight, borderTopWidth: cs.borderTopWidth, borderTopColor: cs.borderTopColor, margin: cs.margin };
    }), null, 2));
  }
  await activeRow.hover();
  await page.waitForTimeout(150);
  console.log("EP_ROW_HOVER:", JSON.stringify(await activeRow.evaluate((el) => ({ backgroundColor: getComputedStyle(el).backgroundColor })), null, 2));
});

// 零件取证 · 聊天消息（chat-message）computed style 实测（同一 CMP_CAPTURE=1 门）
// 稳定态（用户气泡／AI 整框／头像／meta 行／空态）走真实往返；瞬态（响应中／未完成章）
// 借 serving.py 的闸门端点（gated-e2e-model＋带素材发送→挂起→停止）实测；
// 思考折叠区假模型无 reasoning 输出、不可达 → 代码级取值（对账注明）。
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
test("measure chat-message computed styles", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();

  // ① 空态
  const empty = page.getByText(/暂无消息/);
  await empty.waitFor({ state: "visible", timeout: 10_000 });
  console.log("CHATMSG_EMPTY:", JSON.stringify(await empty.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { fontSize: cs.fontSize, color: cs.color, textAlign: cs.textAlign, marginTop: cs.marginTop };
  }), null, 2));

  // ② 文本往返（默认种子端点，假模型秒回）
  await page.getByLabel("打标指令").fill("取证·用户消息：给这张图写一段训练用描述。");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByText("E2E 假模型的打标结果").last().waitFor({ state: "visible", timeout: 20_000 });
  await page.mouse.move(10, 500);
  await page.waitForTimeout(300);
  const userBubble = page.getByText("取证·用户消息：给这张图写一段训练用描述。").last();
  console.log("CHATMSG_USER_BUBBLE:", JSON.stringify(await userBubble.evaluate(SCENE_BOX), null, 2));
  const aiBox = page.locator(".rounded-xl.rounded-bl-sm").last();
  console.log("CHATMSG_AI_BOX:", JSON.stringify(await aiBox.evaluate(SCENE_BOX), null, 2));
  console.log("CHATMSG_AI_TEXT:", JSON.stringify(await page.getByText("E2E 假模型的打标结果").last().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { fontSize: cs.fontSize, lineHeight: cs.lineHeight, color: cs.color, padding: cs.padding };
  }), null, 2));
  const avatar = page.locator("span.bg-black").last();
  console.log("CHATMSG_AVATAR:", JSON.stringify(await avatar.evaluate((el) => {
    const cs = getComputedStyle(el);
    const img = el.querySelector("img");
    return { width: el.offsetWidth, height: el.offsetHeight, borderRadius: cs.borderRadius, backgroundColor: cs.backgroundColor, marginRight: cs.marginRight, logoSize: img ? getComputedStyle(img).width : null };
  }), null, 2));
  const metaRow = page.locator(".text-muted-foreground.flex").last();
  console.log("CHATMSG_META:", JSON.stringify(await metaRow.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { fontSize: cs.fontSize, color: cs.color, gap: cs.gap, marginTop: cs.marginTop };
  }), null, 2));
  console.log("CHATMSG_META_MODEL:", JSON.stringify(await metaRow.locator("span.truncate").first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { text: (el.textContent ?? "").slice(0, 30), fontSize: cs.fontSize, color: cs.color };
  }), null, 2));
  const copyBtn = metaRow.getByRole("button", { name: "复制 caption" });
  console.log("CHATMSG_COPY_BTN:", JSON.stringify(await copyBtn.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { width: el.offsetWidth, height: el.offsetHeight, borderRadius: cs.borderRadius };
  }), null, 2));
  console.log("CHATMSG_META_TIME:", JSON.stringify(await metaRow.locator("span.ml-auto").first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { text: (el.textContent ?? "").slice(0, 8), fontSize: cs.fontSize, color: cs.color };
  }), null, 2));

  // ③ 闸门端点：建 → 切换 → 带附件发送 → 挂起于闸门 → 实测「响应中」→ 停止 → 实测「未完成」章
  const gateSetup = await page.evaluate(async () => {
    const r = await fetch("/api/endpoints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "取证·闸门端点",
        base_url: "http://127.0.0.1:8765/fake-llm/v1",
        model: "gated-e2e-model",
        api_key: "sk-probe-noop", // pragma: allowlist secret — 取证造数假密钥
        api_format: "openai-chat-completions",
      }),
    });
    return { status: r.status };
  });
  console.log("CHATMSG_GATE_SETUP:", JSON.stringify(gateSetup));
  await page.reload();
  await page.getByRole("button", { name: "端点配置切换器" }).click();
  const gateMenu = page.getByRole("menu");
  await gateMenu.waitFor({ state: "visible", timeout: 5000 });
  await gateMenu.getByRole("menuitem", { name: /取证·闸门端点/ }).click();
  await page.waitForTimeout(500);

  await page.locator('input[type="file"]').setInputFiles({
    name: "probe.png", mimeType: "image/png", buffer: PNG_1PX,
  });
  await page.getByLabel("打标指令").fill("取证·闸门消息：描述这张图。");
  await page.getByRole("button", { name: "发送", exact: true }).click();

  // 等模型请求进闸门（服务器挂起 → 前端停在「响应中」）
  await page.waitForFunction(async () => {
    const r = await fetch("/__test__/gated-entered", { method: "POST" });
    return (await r.json() as { entered: boolean }).entered;
  }, undefined, { timeout: 20_000, polling: 300 });
  await page.waitForTimeout(400);
  const streamStatus = page.getByText(/响应中 · 已用时/);
  console.log("CHATMSG_STREAM_STATUS:", JSON.stringify(await streamStatus.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { text: (el.textContent ?? "").slice(0, 16), fontSize: cs.fontSize, color: cs.color, padding: cs.padding };
  }), null, 2));
  const userAtt = page.locator("button[aria-label^='预览'], button[aria-label='probe.png']").last();
  console.log("CHATMSG_ATT_THUMB:", JSON.stringify(await userAtt.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { width: el.offsetWidth, height: el.offsetHeight, borderRadius: cs.borderRadius, backgroundColor: cs.backgroundColor, boxShadow: cs.boxShadow === "none" ? "none" : "(has shadow)" };
  }), null, 2));

  // 停止 → 闸门阶段（思考与正文都为空）中断 = 不落消息（keepPartial 空内容早退，
  // chat-session.tsx:365）——行为事实记录；「未完成」章只在已收到部分内容时出现，
  // 假模型无分块节奏、窗口不可达 → 章取值走代码级（对账注明）。
  await page.getByRole("button", { name: "停止生成" }).click();
  await page.waitForTimeout(800);
  const partial = page.getByText(/未完成 · 生成中断/);
  const partialCount = await partial.count();
  console.log("CHATMSG_PARTIAL:", JSON.stringify({ count: partialCount, note: partialCount === 0 ? "空内容中断不落消息（keepPartial 早退）" : "unexpected" }));
  console.log("CHATMSG_PARTIAL_CODE_LEVEL:", JSON.stringify({
    cls: "rounded-sm bg-amber-100 px-1.5 py-0.5 text-t-xs text-amber-700",
    note: "amber-100/amber-700 为 Tailwind 默认字面量、非语义令牌——疑似违 2.1，进对齐批裁决",
  }));
  await page.evaluate(async () => { await fetch("/__test__/gated-release", { method: "POST" }); });
});

// 零件取证 · 附件条（attachment）computed style 实测（同一 CMP_CAPTURE=1 门）
// 待发附件卡：图片卡全量实测；视频卡用真 mp4（客户端抽帧，解码失败静默回退图标——
// captureVideoMeta 失败即 {}，实际落哪个形态如实记录）；行为事实：单槽（再选即替换）、
// 移除即清、缩略图点击开大图预览（lightbox）。
test("measure attachment computed styles", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();

  const shell = page.locator("div.mt-auto > div.rounded-xl.border-input");
  await shell.waitFor({ state: "visible", timeout: 10_000 });

  // ① 图片附件卡
  await page.locator('input[type="file"]').setInputFiles({
    name: "att-probe.png", mimeType: "image/png", buffer: PNG_1PX,
  });
  const card = shell.locator("div.rounded-lg").first();
  await card.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(300);

  console.log("ATT_SHELL:", JSON.stringify(await shell.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { width: el.offsetWidth, borderRadius: cs.borderRadius, borderWidth: cs.borderTopWidth, borderColor: cs.borderTopColor, backgroundColor: cs.backgroundColor, padding: cs.padding };
  }), null, 2));
  console.log("ATT_CARD:", JSON.stringify(await card.evaluate((el) => {
    const cs = getComputedStyle(el);
    const kids = Array.from(el.children).map((c) => c.tagName.toLowerCase());
    return { height: el.offsetHeight, childTags: kids.join(","), borderRadius: cs.borderRadius, borderWidth: cs.borderTopWidth, borderColor: cs.borderTopColor, backgroundColor: cs.backgroundColor, padding: cs.padding, gap: cs.gap, marginBottom: cs.marginBottom, maxWidth: cs.maxWidth };
  }), null, 2));
  const thumbBtn = card.locator("button[aria-label^='预览']").first();
  console.log("ATT_THUMB_BTN:", JSON.stringify(await thumbBtn.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { width: el.offsetWidth, height: el.offsetHeight, cursor: cs.cursor };
  }), null, 2));
  console.log("ATT_THUMB_IMG:", JSON.stringify(await thumbBtn.locator("img").evaluate((el) => {
    const cs = getComputedStyle(el);
    return { width: cs.width, height: cs.height, borderRadius: cs.borderRadius, objectFit: cs.objectFit };
  }), null, 2));
  console.log("ATT_NAME:", JSON.stringify(await card.locator("div.truncate").first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { text: el.textContent, fontSize: cs.fontSize, color: cs.color, fontWeight: cs.fontWeight };
  }), null, 2));
  console.log("ATT_SUB:", JSON.stringify(await card.locator(".text-t-xs").first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { text: el.textContent, fontSize: cs.fontSize, color: cs.color };
  }), null, 2));
  const BTN_SHAPE = (el: HTMLElement): Record<string, unknown> => {
    const cs = getComputedStyle(el);
    const svg = el.querySelector("svg");
    return { width: el.offsetWidth, height: el.offsetHeight, borderRadius: cs.borderRadius, backgroundColor: cs.backgroundColor, color: cs.color, svgWidth: svg ? getComputedStyle(svg).width : null };
  };
  const rmBtn = card.getByRole("button", { name: "移除附件" });
  console.log("ATT_REMOVE:", JSON.stringify(await rmBtn.evaluate(BTN_SHAPE), null, 2));
  await rmBtn.hover();
  await page.waitForTimeout(250);
  console.log("ATT_REMOVE_HOVER:", JSON.stringify(await rmBtn.evaluate((el) => ({ backgroundColor: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color })), null, 2));
  await page.mouse.move(10, 500);
  console.log("ATT_ADD_BTN:", JSON.stringify(await page.getByRole("button", { name: "附图片或视频（最多 1 个）" }).evaluate(BTN_SHAPE), null, 2));
  console.log("ATT_SKILL_BTN:", JSON.stringify(await page.getByRole("button", { name: "添加 Skill" }).evaluate(BTN_SHAPE), null, 2));
  console.log("ATT_HELPER:", JSON.stringify(await page.getByText("Enter 发送 · Shift+Enter 换行").evaluate((el) => {
    const cs = getComputedStyle(el);
    return { text: el.textContent, fontSize: cs.fontSize, color: cs.color, marginLeft: cs.marginLeft };
  }), null, 2));
  const ta = page.getByLabel("打标指令");
  console.log("ATT_TEXTAREA:", JSON.stringify(await ta.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { minHeight: cs.minHeight, padding: cs.padding, fontSize: cs.fontSize, lineHeight: cs.lineHeight, color: cs.color };
  }), null, 2));
  await ta.focus();
  await page.waitForTimeout(200);
  console.log("ATT_SHELL_FOCUSWITHIN:", JSON.stringify(await shell.evaluate((el) => ({ borderColor: getComputedStyle(el).borderTopColor })), null, 2));
  await page.mouse.move(10, 500);
  console.log("ATT_ACCEPT:", JSON.stringify({ accept: await page.locator('input[type="file"]').getAttribute("accept") }));

  // ② 视频附件卡（真 mp4；封面抽帧成败如实记录——Chromium 缺 H.264 解码时静默回退图标）
  await page.locator('input[type="file"]').setInputFiles({
    name: "att-probe.mp4", mimeType: "video/mp4",
    buffer: readFileSync(resolve(process.cwd(), "../../context/test/materials/videos/mp4/preparing-a-bowl-with-yogurt-and-43925.mp4")),
  });
  await card.getByText("att-probe.mp4").waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(3500);   // 抽帧 3s 超时窗走完，落定封面或图标
  console.log("ATT_VIDEO_CARD:", JSON.stringify(await card.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { height: el.offsetHeight, paddingRight: cs.paddingRight };
  }), null, 2));
  console.log("ATT_FPS_INPUT:", JSON.stringify(await page.getByLabel("视频抽帧 fps").evaluate((el) => {
    const cs = getComputedStyle(el);
    return { width: el.offsetWidth, height: el.offsetHeight, borderRadius: cs.borderRadius, borderWidth: cs.borderTopWidth, borderColor: cs.borderTopColor, backgroundColor: cs.backgroundColor, fontSize: cs.fontSize, padding: cs.padding };
  }), null, 2));
  console.log("ATT_MAXFRAMES_INPUT:", JSON.stringify(await page.getByLabel("视频抽帧帧数上限").evaluate((el) => ({ width: el.offsetWidth, height: el.offsetHeight })), null, 2));
  console.log("ATT_FPS_LABEL:", JSON.stringify(await card.locator("label").filter({ hasText: "fps" }).first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { text: el.textContent, fontSize: cs.fontSize, color: cs.color, gap: cs.gap };
  }), null, 2));
  const videoThumbImg = thumbBtn.locator("img");
  const videoThumbIcon = thumbBtn.locator("svg");
  const hasPoster = (await videoThumbImg.count()) > 0;
  console.log("ATT_VIDEO_THUMB:", JSON.stringify({
    hasPosterImg: hasPoster,
    hasFallbackIcon: (await videoThumbIcon.count()) > 0,
    ...(hasPoster
      ? await videoThumbImg.evaluate((el) => ({ width: getComputedStyle(el).width, height: getComputedStyle(el).height, borderRadius: getComputedStyle(el).borderRadius }))
      : await videoThumbIcon.evaluate((el) => ({ width: el.offsetWidth, height: el.offsetHeight, borderRadius: getComputedStyle(el).borderRadius, backgroundColor: getComputedStyle(el).backgroundColor, padding: getComputedStyle(el).padding }))),
  }, null, 2));
  console.log("ATT_VIDEO_SUB:", JSON.stringify({ text: await card.locator(".text-t-xs").first().textContent() }));

  // ③ 替换（单槽）：再选一张图 → 名字换新、仍只一张卡
  await page.locator('input[type="file"]').setInputFiles({
    name: "att-probe-2.png", mimeType: "image/png", buffer: PNG_1PX,
  });
  await page.waitForTimeout(500);
  console.log("ATT_REPLACE:", JSON.stringify({ cardCount: await shell.locator("div.rounded-lg").count(), name: await card.locator("div.truncate").first().textContent() }));

  // ④ 缩略图点击 → 大图预览（lightbox）→ Esc 关闭
  await thumbBtn.click();
  await page.locator("div.fixed.inset-0.z-50").first().waitFor({ state: "visible", timeout: 5_000 });
  console.log("ATT_PREVIEW:", JSON.stringify({ lightboxOpen: await page.locator("div.fixed.inset-0.z-50").count() > 0 }));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // ⑤ 移除 → 条消失
  await rmBtn.click();
  await page.waitForTimeout(300);
  console.log("ATT_REMOVE_RESULT:", JSON.stringify({ cardCount: await shell.locator("div.rounded-lg").count() }));
});

// 零件取证 · Skill 选择（skill-picker）computed style 实测（同一 CMP_CAPTURE=1 门）
// API 造数：临时 SKILL.md ×3 → /api/skills/import → 停用其一；量触发件／弹层／勾选行／指示器／
// 已选 chips；行为事实：勾选即时生效（会话域）、菜单不关、脏态不拦（toggleSkill 无 dirty 检查）。
test("measure skill-picker computed styles", async ({ page }) => {
  test.setTimeout(120_000);
  const dir = mkdtempSync(join(tmpdir(), "dsf-skill-probe-"));
  const mk = (file: string, name: string, desc: string): string => {
    const p = join(dir, file);
    writeFileSync(p, `---\nname: ${name}\ndescription: ${desc}\nlicense: MIT\n---\n\n取证用技能正文。\n`);
    return p;
  };
  const paths = [
    mk("skill-a.md", "取证·skill甲", "面向取证场景的描述甲，用于量行内描述截断。"),
    mk("skill-b.md", "取证·skill乙", "面向取证场景的描述乙。"),
    mk("skill-off.md", "取证·skill停用", "面向取证场景的停用描述。"),
  ];
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  const ids: string[] = [];
  for (const p of paths) {
    const r = await page.evaluate(async (src) => {
      const res = await fetch("/api/skills/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: src }),
      });
      return { status: res.status, body: await res.json() };
    }, p);
    console.log("SKILL_IMPORT:", JSON.stringify({ path: p.split(/[\\/]/).pop(), status: r.status, id: (r.body as { id?: string }).id }));
    ids.push((r.body as { id?: string }).id ?? "");
  }
  await page.evaluate(async (sid) => { await fetch(`/api/skills/${sid}/disable`, { method: "POST" }); }, ids[2]);
  await page.reload();

  const addBtn = page.getByRole("button", { name: "添加 Skill" });
  await addBtn.waitFor({ state: "visible", timeout: 10_000 });
  console.log("SKILL_TRIGGER:", JSON.stringify(await addBtn.evaluate((el) => {
    const cs = getComputedStyle(el);
    const svg = el.querySelector("svg");
    return { width: el.offsetWidth, height: el.offsetHeight, borderRadius: cs.borderRadius, backgroundColor: cs.backgroundColor, color: cs.color, svgWidth: svg ? getComputedStyle(svg).width : null };
  }), null, 2));
  await addBtn.click();
  const menu = page.getByRole("menu");
  await menu.waitFor({ state: "visible", timeout: 5_000 });
  await page.waitForTimeout(300);

  console.log("SKILL_MENU:", JSON.stringify(await menu.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { width: el.offsetWidth, height: el.offsetHeight, maxWidth: cs.maxWidth, borderRadius: cs.borderRadius, borderWidth: cs.borderTopWidth, borderColor: cs.borderTopColor, backgroundColor: cs.backgroundColor, padding: cs.padding, gap: cs.gap, boxShadow: cs.boxShadow === "none" ? "none" : "(has shadow)" };
  }), null, 2));
  console.log("SKILL_LABEL:", JSON.stringify(await page.getByText(/Skill 库 · 共/).evaluate((el) => {
    const cs = getComputedStyle(el);
    return { text: el.textContent, fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color, padding: cs.padding };
  }), null, 2));
  console.log("SKILL_HEAD_ACTIONS:", JSON.stringify({ settingsBtnCount: await menu.locator("button").count(), note: "头行动作钮位（原型有 settings 钮）" }));

  const rowOn = menu.getByRole("menuitemcheckbox", { name: "取证·skill甲" });
  const rowOff = menu.getByRole("menuitemcheckbox", { name: /取证·skill停用/ });
  console.log("SKILL_ROW:", JSON.stringify(await rowOn.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { height: el.offsetHeight, borderRadius: cs.borderRadius, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight, fontSize: cs.fontSize, color: cs.color };
  }), null, 2));
  console.log("SKILL_ROW_DESC:", JSON.stringify({ descCount: await rowOn.locator("span").count(), note: "实现行内是否渲染 description" }));
  const indicator = rowOn.locator("span.absolute").first();
  console.log("SKILL_INDICATOR:", JSON.stringify(await indicator.evaluate((el) => {
    const cs = getComputedStyle(el);
    const svg = el.querySelector("svg");
    return { boxW: el.offsetWidth, boxH: el.offsetHeight, left: cs.left, svgW: svg ? getComputedStyle(svg).width : null, svgVisible: svg ? getComputedStyle(svg).display : null };
  }), null, 2));
  console.log("SKILL_ROW_DISABLED:", JSON.stringify(await rowOff.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { text: (el.textContent ?? "").slice(0, 22), opacity: cs.opacity, color: cs.color, dataDisabled: el.getAttribute("data-disabled") };
  }), null, 2));
  await rowOn.hover();
  await page.waitForTimeout(250);
  console.log("SKILL_ROW_HOVER:", JSON.stringify(await rowOn.evaluate((el) => ({ backgroundColor: getComputedStyle(el).backgroundColor })), null, 2));
  await page.mouse.move(10, 500);

  // 勾选两个（菜单保持打开——onSelect preventDefault）
  await rowOn.click();
  await menu.getByRole("menuitemcheckbox", { name: "取证·skill乙" }).click();
  await page.waitForTimeout(300);
  console.log("SKILL_CHECKED_STATE:", JSON.stringify({
    menuStillOpen: await menu.isVisible(),
    rowChecked: await rowOn.getAttribute("data-state"),
  }));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // 已选 chips（输入区 Foot）
  const chipX = page.getByRole("button", { name: "移除 Skill 取证·skill甲" });
  await chipX.waitFor({ state: "visible", timeout: 5_000 });
  const chip = chipX.locator("..");
  console.log("SKILL_CHIP_STRIP:", JSON.stringify(await chip.evaluate((el) => {
    const cs = getComputedStyle(el.parentElement);
    return { gap: cs.gap, overflowX: cs.overflowX };
  }), null, 2));
  console.log("SKILL_CHIP:", JSON.stringify(await chip.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { height: el.offsetHeight, borderRadius: cs.borderRadius, borderWidth: cs.borderTopWidth, borderColor: cs.borderTopColor, backgroundColor: cs.backgroundColor, color: cs.color, paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight, fontSize: cs.fontSize, gap: cs.gap };
  }), null, 2));
  console.log("SKILL_CHIP_X:", JSON.stringify(await chipX.evaluate((el) => {
    const cs = getComputedStyle(el);
    const svg = el.querySelector("svg");
    return { w: el.offsetWidth, h: el.offsetHeight, color: cs.color, svgW: svg ? getComputedStyle(svg).width : null, bg: cs.backgroundColor };
  }), null, 2));
  await chipX.click();
  await page.waitForTimeout(300);
  console.log("SKILL_CHIP_REMOVE:", JSON.stringify({ chipsLeft: await page.getByRole("button", { name: /移除 Skill / }).count() }));
});

// 页面稿取证 · 策略页整页版面 computed style 实测（同一 CMP_CAPTURE=1 门）。
// 对象 = 页面级拼装：外壳（侧栏/导航/品牌标）、顶栏、两栏骨架、左栏白框与字段、
// 右栏对话区（头行/消息流/输入区）、空态。零件级取值由各自零件稿取证块管，这里只量拼装。
test("measure workbench page layout computed styles", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();
  await page.getByRole("button", { name: "策略", exact: true }).click();
  await page.getByRole("textbox").first().waitFor({ state: "visible", timeout: 10_000 });

  // ---- 外壳 ----
  console.log("WB_SHELL:", JSON.stringify(await page.getByTestId("sidebar").evaluate((el) => {
    const cs = getComputedStyle(el);
    return { width: el.offsetWidth, paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight, paddingTop: cs.paddingTop, background: cs.backgroundColor, borderRightWidth: cs.borderRightWidth };
  }), null, 2));
  console.log("WB_NAV_ACTIVE:", JSON.stringify(await page.getByRole("button", { name: "策略", exact: true }).evaluate((el) => {
    const cs = getComputedStyle(el);
    return { height: el.offsetHeight, borderRadius: cs.borderRadius, paddingLeft: cs.paddingLeft, background: cs.backgroundColor, color: cs.color, fontWeight: cs.fontWeight, fontSize: cs.fontSize, gap: cs.gap };
  }), null, 2));
  console.log("WB_NAV_IDLE:", JSON.stringify(await page.getByRole("button", { name: "打标", exact: true }).evaluate((el) => {
    const cs = getComputedStyle(el);
    return { background: cs.backgroundColor, color: cs.color, fontWeight: cs.fontWeight };
  }), null, 2));
  console.log("WB_BRAND:", JSON.stringify(await page.getByRole("button", { name: /侧栏/ }).evaluate((el) => {
    const cs = getComputedStyle(el);
    const img = el.querySelector("img");
    return { boxW: el.offsetWidth, boxH: el.offsetHeight, borderRadius: cs.borderRadius, background: cs.backgroundColor, logoW: img ? getComputedStyle(img).width : null };
  }), null, 2));

  // ---- 顶栏（策略行）----
  console.log("WB_TOP:", JSON.stringify(await page.locator("header").evaluate((el) => {
    const cs = getComputedStyle(el);
    return { paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight, borderBottomWidth: cs.borderBottomWidth, borderBottomColor: cs.borderBottomColor, height: el.offsetHeight };
  }), null, 2));
  console.log("WB_TOP_ROW:", JSON.stringify(await page.locator("header > div").first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { gap: cs.gap, flexWrap: cs.flexWrap };
  }), null, 2));
  console.log("WB_TOP_DESC:", JSON.stringify(await page.getByLabel("策略描述").evaluate((el) => {
    const cs = getComputedStyle(el);
    return { fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight, borderWidth: cs.borderTopWidth };
  }), null, 2));

  // ---- 两栏骨架 ----
  const leftSec = page.getByLabel("提示词编辑列");
  const rightSec = page.getByLabel("调试对话列");
  console.log("WB_GRID:", JSON.stringify(await page.evaluate(() => {
    const fieldset = document.querySelector("fieldset");
    const cs = getComputedStyle(fieldset!);
    const left = document.querySelector('[aria-label="提示词编辑列"]')!;
    const right = document.querySelector('[aria-label="调试对话列"]')!;
    return {
      gridTemplateColumns: cs.gridTemplateColumns,
      columnGap: cs.columnGap,
      leftWidth: left.getBoundingClientRect().width,
      rightWidth: right.getBoundingClientRect().width,
      mainPaddingLeft: getComputedStyle(document.querySelector("main")!).paddingLeft,
    };
  }), null, 2));
  console.log("WB_COL_LEFT:", JSON.stringify(await leftSec.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight };
  }), null, 2));
  console.log("WB_COL_RIGHT:", JSON.stringify(await rightSec.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight, borderLeftWidth: cs.borderLeftWidth, borderLeftColor: cs.borderLeftColor };
  }), null, 2));

  // ---- 左栏白框与字段 ----
  console.log("WB_CARD:", JSON.stringify(await leftSec.locator("> div").first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { borderRadius: cs.borderRadius, borderWidth: cs.borderTopWidth, borderColor: cs.borderTopColor, background: cs.backgroundColor, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight };
  }), null, 2));
  console.log("WB_TAG:", JSON.stringify(await leftSec.getByText("提示词", { exact: true }).evaluate((el) => {
    const cs = getComputedStyle(el);
    return { fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color };
  }), null, 2));
  console.log("WB_FIELD_LABEL:", JSON.stringify(await page.locator('label[for="prompt-desc"]').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color, marginBottom: cs.marginBottom, height: el.offsetHeight };
  }), null, 2));
  // 顶栏高度构成：名字框（派生档 42）与描述框各自高度，核对 88 vs 83 的差从哪来
  console.log("WB_TOP_NAME:", JSON.stringify(await page.locator('header [aria-label="策略名称"]').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { height: el.offsetHeight, fontSize: cs.fontSize, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom };
  }), null, 2));
  console.log("WB_DESC_INPUT:", JSON.stringify(await page.locator("#prompt-desc").evaluate((el) => {
    const cs = getComputedStyle(el);
    return { height: el.offsetHeight, borderRadius: cs.borderRadius, borderWidth: cs.borderTopWidth, borderColor: cs.borderTopColor, background: cs.backgroundColor, fontSize: cs.fontSize };
  }), null, 2));
  console.log("WB_BODY_LABEL:", JSON.stringify(await page.getByText("正文", { exact: true }).evaluate((el) => {
    const cs = getComputedStyle(el);
    return { fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color };
  }), null, 2));
  console.log("WB_METER:", JSON.stringify(await page.locator('[aria-label="提示词编辑列"] span.tabular-nums').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { text: el.textContent, fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color };
  }), null, 2));
  console.log("WB_BODY_BOX:", JSON.stringify(await page.locator('[data-slot="prompt-body"]').evaluate((el) => {
    const cs = getComputedStyle(el);
    const wrap = el.parentElement!;
    const wcs = getComputedStyle(wrap);
    return { wrapBorderRadius: wcs.borderRadius, wrapBorderWidth: wcs.borderTopWidth, wrapBorderColor: wcs.borderTopColor, wrapBackground: wcs.backgroundColor, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, paddingLeft: cs.paddingLeft, fontSize: cs.fontSize, lineHeight: cs.lineHeight, fontFamilyHint: cs.fontFamily.split(",")[0] };
  }), null, 2));

  // ---- 右栏对话区 ----
  console.log("WB_CHATHEAD:", JSON.stringify(await page.locator('[aria-label="调试对话列"] > div').first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { gap: cs.gap, paddingBottom: cs.paddingBottom };
  }), null, 2));
  console.log("WB_CHAT_TITLE:", JSON.stringify(await page.getByRole("heading", { name: "对话" }).evaluate((el) => {
    const cs = getComputedStyle(el);
    return { fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color };
  }), null, 2));
  const msgs = page.getByRole("log", { name: "消息流" });
  console.log("WB_MSGS:", JSON.stringify(await msgs.evaluate((el) => {
    const cs = getComputedStyle(el);
    const first = el.firstElementChild as HTMLElement | null;
    return { paddingTop: cs.paddingTop, paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight, firstChildMarginTop: first ? getComputedStyle(first).marginTop : null, childCount: el.children.length };
  }), null, 2));
  console.log("WB_EMPTY:", JSON.stringify(await msgs.locator("p").evaluate((el) => {
    const cs = getComputedStyle(el);
    return { text: el.textContent, fontSize: cs.fontSize, color: cs.color, marginTop: cs.marginTop, textAlign: cs.textAlign };
  }), null, 2));

  // ---- 输入区（composer）----
  const composerBox = page.locator("textarea[aria-label=\"打标指令\"]").locator("..");
  console.log("WB_COMPOSER_WRAP:", JSON.stringify(await composerBox.evaluate((el) => {
    const outer = el.parentElement!; // mt-auto pt-4 层
    const ocs = getComputedStyle(outer);
    return { outerPaddingTop: ocs.paddingTop, outerMarginTop: ocs.marginTop };
  }), null, 2));
  console.log("WB_COMPOSER_BOX:", JSON.stringify(await composerBox.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { borderRadius: cs.borderRadius, borderWidth: cs.borderTopWidth, borderColor: cs.borderTopColor, background: cs.backgroundColor, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight };
  }), null, 2));
  console.log("WB_COMPOSER_TA:", JSON.stringify(await page.locator("textarea[aria-label=\"打标指令\"]").evaluate((el) => {
    const cs = getComputedStyle(el);
    return { minHeight: cs.minHeight, lineHeight: cs.lineHeight, fontSize: cs.fontSize, color: cs.color, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight };
  }), null, 2));
  console.log("WB_COMPOSER_FOOT:", JSON.stringify(await page.locator("textarea[aria-label=\"打标指令\"]").evaluate((el) => {
    const foot = el.nextElementSibling as HTMLElement;
    const cs = getComputedStyle(foot);
    return { gap: cs.gap };
  }), null, 2));
  console.log("WB_HINT:", JSON.stringify(await page.getByText("Enter 发送 · Shift+Enter 换行").evaluate((el) => {
    const cs = getComputedStyle(el);
    return { fontSize: cs.fontSize, color: cs.color, marginLeft: cs.marginLeft };
  }), null, 2));
  // focus-within：聚焦正文输入框，量输入区壳描边
  await page.locator("textarea[aria-label=\"打标指令\"]").focus();
  await page.waitForTimeout(200);
  console.log("WB_COMPOSER_FOCUS:", JSON.stringify(await composerBox.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { borderColor: cs.borderTopColor };
  }), null, 2));
});

// 零件取证 · 侧栏品牌标（sidebar-brand）computed style 实测（同一 CMP_CAPTURE=1 门）。
// 展开态（头行/品牌钮/品牌图/让位图标/名与副题/悬停让位/Tip）→ 折叠态（64 图标条、文字隐藏、
// aria 随态）→ 暗色（品牌黑底不随主题翻转）→ 设置页（side-head 整体不存在）。
const BRAND_BOX = (el: HTMLElement): Record<string, string | number> => {
  const cs = getComputedStyle(el);
  return {
    width: el.offsetWidth, height: el.offsetHeight,
    paddingTop: cs.paddingTop, paddingRight: cs.paddingRight,
    paddingBottom: cs.paddingBottom, paddingLeft: cs.paddingLeft,
    gap: cs.gap, borderRadius: cs.borderRadius,
    backgroundColor: cs.backgroundColor,
  };
};

test("measure sidebar-brand computed styles", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await page.getByRole("button", { name: "策略", exact: true }).click();
  await page.getByRole("textbox").first().waitFor({ state: "visible", timeout: 10_000 });

  const sidebar = page.getByTestId("sidebar");
  const head = sidebar.locator("> div").first();
  const brandBtn = sidebar.getByRole("button", { name: "收起侧栏" });
  const nameEl = sidebar.getByText("Dataset Factory", { exact: true });
  const subEl = sidebar.getByText("打标流水线工具", { exact: true });

  // ---- 展开态（静止）----
  console.log("SB_HEAD:", JSON.stringify(await head.evaluate(BRAND_BOX), null, 2));
  console.log("SB_BTN:", JSON.stringify(await brandBtn.evaluate(BRAND_BOX), null, 2));
  console.log("SB_BTN_ICON_REST:", JSON.stringify(await brandBtn.evaluate((el) => {
    const img = el.querySelector("img");
    const svg = el.querySelector("svg");
    return img && svg
      ? { imgDisplay: getComputedStyle(img).display, imgWidth: getComputedStyle(img).width, imgHeight: getComputedStyle(img).height, imgObjectFit: getComputedStyle(img).objectFit, svgDisplay: getComputedStyle(svg).display }
      : { missing: true };
  }), null, 2));
  console.log("SB_NAME:", JSON.stringify(await nameEl.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { fontSize: cs.fontSize, fontWeight: cs.fontWeight, lineHeight: cs.lineHeight, color: cs.color, whiteSpace: cs.whiteSpace, overflow: cs.overflow, textOverflow: cs.textOverflow };
  }), null, 2));
  console.log("SB_SUB:", JSON.stringify(await subEl.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { fontSize: cs.fontSize, fontWeight: cs.fontWeight, lineHeight: cs.lineHeight, color: cs.color, whiteSpace: cs.whiteSpace, overflow: cs.overflow, textOverflow: cs.textOverflow };
  }), null, 2));
  console.log("SB_SIDEBAR:", JSON.stringify(await sidebar.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { width: el.offsetWidth, backgroundColor: cs.backgroundColor };
  }), null, 2));

  // ---- 悬停让位（等 transition 落定 ≥300ms；Tip 随悬停出现）----
  await brandBtn.hover();
  await page.waitForTimeout(350);
  console.log("SB_BTN_HOVER:", JSON.stringify(await brandBtn.evaluate((el) => {
    const cs = getComputedStyle(el);
    const img = el.querySelector("img");
    const svg = el.querySelector("svg");
    return img && svg
      ? { backgroundColor: cs.backgroundColor, imgDisplay: getComputedStyle(img).display, svgDisplay: getComputedStyle(svg).display, svgWidth: getComputedStyle(svg).width, svgHeight: getComputedStyle(svg).height, svgColor: getComputedStyle(svg).color }
      : { missing: true };
  }), null, 2));
  const tip = page.locator('[data-slot="tooltip-content"]');
  await tip.waitFor({ state: "visible", timeout: 5000 });
  console.log("SB_TIP:", JSON.stringify({ text: (await tip.textContent() ?? "").trim() }));
  await page.mouse.move(10, 500);
  await page.waitForTimeout(200);

  // ---- 折叠态：点品牌钮收起（宽度过渡 150ms 后再量；鼠标挪开防悬停污染）----
  await brandBtn.click();
  await page.waitForTimeout(400);
  const brandBtnCollapsed = sidebar.getByRole("button", { name: "展开侧栏" });
  console.log("SB_COLLAPSED:", JSON.stringify(await sidebar.evaluate((el) => {
    const cs = getComputedStyle(el);
    const headEl = el.querySelector(":scope > div");
    const hcs = headEl ? getComputedStyle(headEl) : null;
    return {
      width: el.offsetWidth,
      textCount: el.querySelectorAll(".min-w-0").length,
      headPadding: hcs ? `${hcs.paddingTop} ${hcs.paddingRight} ${hcs.paddingBottom} ${hcs.paddingLeft}` : null,
    };
  }), null, 2));
  console.log("SB_COLLAPSED_BTN:", JSON.stringify(await brandBtnCollapsed.evaluate(BRAND_BOX), null, 2));
  await brandBtnCollapsed.hover();
  await page.waitForTimeout(350);
  console.log("SB_COLLAPSED_HOVER:", JSON.stringify(await brandBtnCollapsed.evaluate((el) => {
    const cs = getComputedStyle(el);
    const img = el.querySelector("img");
    const svg = el.querySelector("svg");
    return img && svg
      ? { backgroundColor: cs.backgroundColor, imgDisplay: getComputedStyle(img).display, svgDisplay: getComputedStyle(svg).display }
      : { missing: true };
  }), null, 2));
  const tipC = page.locator('[data-slot="tooltip-content"]');
  await tipC.waitFor({ state: "visible", timeout: 5000 });
  console.log("SB_COLLAPSED_TIP:", JSON.stringify({ text: (await tipC.textContent() ?? "").trim() }));
  await page.mouse.move(10, 500);
  await brandBtnCollapsed.click();
  await page.waitForTimeout(400);

  // ---- 暗色（dsf-theme=dark → html.dark）：品牌黑底不随主题翻转、悬停底用暗色 nav-hover ----
  await page.evaluate(() => localStorage.setItem("dsf-theme", "dark"));
  await page.reload();
  await page.getByRole("button", { name: "策略", exact: true }).click();
  await page.getByRole("textbox").first().waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(400);
  const darkBtn = sidebar.getByRole("button", { name: "收起侧栏" });
  console.log("SB_DARK:", JSON.stringify(await Promise.all([
    sidebar.evaluate((el) => ({ sidebarBg: getComputedStyle(el).backgroundColor, width: el.offsetWidth })),
    darkBtn.evaluate((el) => ({ btnBg: getComputedStyle(el).backgroundColor })),
    nameEl.evaluate((el) => ({ nameColor: getComputedStyle(el).color })),
  ]).then(([s, b, n]) => ({ ...s, ...b, ...n })), null, 2));
  await darkBtn.hover();
  await page.waitForTimeout(350);
  console.log("SB_DARK_HOVER:", JSON.stringify(await darkBtn.evaluate((el) => ({ backgroundColor: getComputedStyle(el).backgroundColor })), null, 2));
  await page.mouse.move(10, 500);

  // ---- 设置页：side-head 整体不存在（实现按页切换侧栏头）----
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.waitForTimeout(300);
  console.log("SB_SETTINGS:", JSON.stringify(await sidebar.evaluate((el) => {
    const brandBtns = Array.from(el.querySelectorAll("button")).filter((b) => (b.getAttribute("aria-label") ?? "").includes("侧栏"));
    return { brandBtnCount: brandBtns.length, hasNameText: el.textContent?.includes("Dataset Factory") ?? false };
  }), null, 2));
});

// 零件取证 · 侧栏导航项（sidebar-nav）computed style 实测（同一 CMP_CAPTURE=1 门）。
// 组标签 / 幽灵项 / 当前项 / 悬停 / 折叠居中与分隔线 / 暗色 / 设置页导航（三项同组——间距决策的可见落点）。
test("measure sidebar-nav computed styles", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await page.getByRole("button", { name: "策略", exact: true }).click();
  await page.getByRole("textbox").first().waitFor({ state: "visible", timeout: 10_000 });

  const sidebar = page.getByTestId("sidebar");
  const nav = sidebar.locator("nav");
  const glabel = sidebar.locator("p", { hasText: "工作区" });
  const activeItem = sidebar.getByRole("button", { name: "策略", exact: true });
  const ghostItem = sidebar.getByRole("button", { name: "打标", exact: true });
  const itemBox = (el: HTMLElement) => {
    const cs = getComputedStyle(el);
    const svg = el.querySelector("svg");
    const label = el.querySelector("span");
    return {
      width: el.offsetWidth, height: el.offsetHeight,
      paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight,
      borderRadius: cs.borderRadius, backgroundColor: cs.backgroundColor, color: cs.color,
      fontWeight: cs.fontWeight, columnGap: cs.columnGap,
      iconWidth: svg ? getComputedStyle(svg).width : null,
      labelOverflow: label ? getComputedStyle(label).overflow : null,
      labelTextOverflow: label ? getComputedStyle(label).textOverflow : null,
    };
  };

  console.log("SN_NAV:", JSON.stringify(await nav.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { width: el.offsetWidth, paddingTop: cs.paddingTop, paddingLeft: cs.paddingLeft, paddingBottom: cs.paddingBottom, paddingRight: cs.paddingRight };
  }), null, 2));
  console.log("SN_GLABEL:", JSON.stringify(await glabel.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color, paddingTop: cs.paddingTop, paddingLeft: cs.paddingLeft, paddingBottom: cs.paddingBottom, whiteSpace: cs.whiteSpace };
  }), null, 2));
  console.log("SN_ITEM_ACTIVE:", JSON.stringify(await activeItem.evaluate(itemBox), null, 2));
  console.log("SN_ITEM_GHOST:", JSON.stringify(await ghostItem.evaluate(itemBox), null, 2));
  await ghostItem.hover();
  await page.waitForTimeout(350);
  console.log("SN_ITEM_HOVER:", JSON.stringify(await ghostItem.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { backgroundColor: cs.backgroundColor, color: cs.color };
  }), null, 2));
  await page.mouse.move(10, 500);
  await page.waitForTimeout(200);

  // 折叠态：组标签消失、分隔线现、项居中
  await sidebar.getByRole("button", { name: "收起侧栏" }).click();
  await page.waitForTimeout(400);
  console.log("SN_COLLAPSED:", JSON.stringify(await sidebar.evaluate((el) => {
    const navEl = el.querySelector("nav");
    const sep = navEl ? navEl.querySelector("div.h-px") : null;
    const sepInfo = sep
      ? (() => {
          const cs = getComputedStyle(sep);
          return { height: cs.height, marginTop: cs.marginTop, marginBottom: cs.marginBottom, marginLeft: cs.marginLeft, marginRight: cs.marginRight, backgroundColor: cs.backgroundColor };
        })()
      : null;
    const item = navEl ? navEl.querySelector("button") : null;
    const ics = item ? getComputedStyle(item) : null;
    return { navWidth: navEl?.offsetWidth ?? null, groupLabelCount: navEl ? navEl.querySelectorAll("p").length : null, separator: sepInfo, itemJustify: ics?.justifyContent, itemPaddingLeft: ics?.paddingLeft };
  }), null, 2));
  await sidebar.getByRole("button", { name: "展开侧栏" }).click();
  await page.waitForTimeout(400);

  // 暗色：当前胶囊与悬停底随 tokens 翻转
  await page.evaluate(() => localStorage.setItem("dsf-theme", "dark"));
  await page.reload();
  await page.getByRole("button", { name: "策略", exact: true }).click();
  await page.getByRole("textbox").first().waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(400);
  const darkActive = sidebar.getByRole("button", { name: "策略", exact: true });
  const darkGhost = sidebar.getByRole("button", { name: "打标", exact: true });
  console.log("SN_DARK:", JSON.stringify({
    activeBg: await darkActive.evaluate((el) => getComputedStyle(el).backgroundColor),
    activeColor: await darkActive.evaluate((el) => getComputedStyle(el).color),
    ghostColor: await darkGhost.evaluate((el) => getComputedStyle(el).color),
  }));
  await darkGhost.hover();
  await page.waitForTimeout(350);
  console.log("SN_DARK_HOVER:", JSON.stringify(await darkGhost.evaluate((el) => ({
    backgroundColor: getComputedStyle(el).backgroundColor,
  }))));
  await page.mouse.move(10, 500);

  // 设置页导航：返回工作区＋三项（同组多enabled项、间距可见的落点）
  await page.evaluate(() => localStorage.removeItem("dsf-theme"));
  await page.reload();
  await page.getByRole("button", { name: "策略", exact: true }).click();
  await page.getByRole("textbox").first().waitFor({ state: "visible", timeout: 10_000 });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.waitForTimeout(300);
  console.log("SN_SETTINGS_NAV:", JSON.stringify(await sidebar.evaluate((el) => {
    const navEl = el.querySelector("nav");
    const btns = navEl ? Array.from(navEl.querySelectorAll("button")) : [];
    const first = btns[0] ? getComputedStyle(btns[0]) : null;
    return {
      itemCount: btns.length,
      itemLabels: btns.map((b) => b.textContent?.trim() ?? b.getAttribute("aria-label") ?? ""),
      adjacentGapsPx: btns.map((b, i) => (i === 0 ? 0 : Math.round((b.getBoundingClientRect().top - btns[i - 1].getBoundingClientRect().bottom) * 10) / 10)),
      firstMarginTop: first?.marginTop,
      itemHeight: btns[0]?.offsetHeight,
      itemRadius: first?.borderRadius,
    };
  }), null, 2));
});

// 零件取证 · 侧栏底部钮组（sidebar-foot）computed style 实测（同一 CMP_CAPTURE=1 门）。
// 三钮静止（关机红图标 / 中性 ghost）→ 真悬停（中性 nav-hover／关机 bad-bg+加深）→ Tip 在场枚举
// （关机钮当前无 Tooltip、主题钮旧复合文案——均为对齐批在案项，实测留证）→ 折叠纵排与版本隐藏 → 暗色。
const SF_BOX = (el: HTMLElement): Record<string, string | number> => {
  const cs = getComputedStyle(el);
  return {
    width: el.offsetWidth, height: el.offsetHeight,
    paddingTop: cs.paddingTop, paddingRight: cs.paddingRight,
    paddingBottom: cs.paddingBottom, paddingLeft: cs.paddingLeft,
    columnGap: cs.columnGap, flexDirection: cs.flexDirection, alignItems: cs.alignItems,
    borderTopWidth: cs.borderTopWidth, borderTopColor: cs.borderTopColor,
    backgroundColor: cs.backgroundColor, transitionDuration: cs.transitionDuration,
  };
};
const SF_BTN = (el: HTMLElement): Record<string, string | number> => {
  const cs = getComputedStyle(el);
  const svg = el.querySelector("svg");
  return {
    width: el.offsetWidth, height: el.offsetHeight,
    borderRadius: cs.borderRadius, backgroundColor: cs.backgroundColor, color: cs.color,
    transitionDuration: cs.transitionDuration,
    svgWidth: svg ? getComputedStyle(svg).width : null,
    svgHeight: svg ? getComputedStyle(svg).height : null,
    svgColor: svg ? getComputedStyle(svg).color : null,
  };
};
const SF_VER = (el: HTMLElement): Record<string, string | number> => {
  const cs = getComputedStyle(el);
  const dot = el.querySelector("span");
  const dcs = dot ? getComputedStyle(dot) : null;
  return {
    columnGap: cs.columnGap, fontSize: cs.fontSize, color: cs.color,
    fontVariantNumeric: cs.fontVariantNumeric, whiteSpace: cs.whiteSpace,
    dotWidth: dcs?.width, dotHeight: dcs?.height, dotRadius: dcs?.borderRadius, dotBg: dcs?.backgroundColor,
  };
};

test("measure sidebar-foot computed styles", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await page.getByRole("button", { name: "策略", exact: true }).click();
  await page.getByRole("textbox").first().waitFor({ state: "visible", timeout: 10_000 });

  const sidebar = page.getByTestId("sidebar");
  const foot = sidebar.locator("> div").last();
  const btnSd = sidebar.getByRole("button", { name: "关闭服务", exact: true });
  const btnTheme = sidebar.locator("button:has(svg.lucide-monitor)");
  const btnSet = sidebar.getByRole("button", { name: "设置", exact: true });
  const ver = sidebar.locator("span.ml-auto");

  // ---- 展开态（静止）----
  console.log("SF_FOOT:", JSON.stringify(await foot.evaluate(SF_BOX), null, 2));
  console.log("SF_BTN_SD:", JSON.stringify(await btnSd.evaluate(SF_BTN), null, 2));
  console.log("SF_BTN_THEME:", JSON.stringify(await btnTheme.evaluate(SF_BTN), null, 2));
  console.log("SF_BTN_SET:", JSON.stringify(await btnSet.evaluate(SF_BTN), null, 2));
  console.log("SF_VER:", JSON.stringify(await ver.evaluate(SF_VER), null, 2));
  console.log("SF_ARIA:", JSON.stringify({
    shutdown: await btnSd.getAttribute("aria-label"),
    theme: await btnTheme.getAttribute("aria-label"),
    settings: await btnSet.getAttribute("aria-label"),
  }));

  // ---- 真悬停（等 transition 落定 ≥300ms）----
  await btnTheme.hover();
  await page.waitForTimeout(350);
  console.log("SF_HOVER_THEME:", JSON.stringify(await btnTheme.evaluate((el) => ({
    backgroundColor: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color,
  })), null, 2));
  const tipTheme = page.locator('[data-slot="tooltip-content"]');
  await tipTheme.waitFor({ state: "visible", timeout: 5000 });
  console.log("SF_TIP_THEME:", JSON.stringify({ text: (await tipTheme.textContent() ?? "").trim() }));
  await page.mouse.move(10, 300);
  await page.waitForTimeout(250);

  await btnSd.hover();
  await page.waitForTimeout(350);
  console.log("SF_HOVER_SD:", JSON.stringify(await btnSd.evaluate((el) => ({
    backgroundColor: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color,
  })), null, 2));
  await page.waitForTimeout(350);
  console.log("SF_TIP_SD:", JSON.stringify({ tooltipCount: await page.locator('[data-slot="tooltip-content"]').count() }));
  await page.mouse.move(10, 300);
  await page.waitForTimeout(250);

  await btnSet.hover();
  await page.waitForTimeout(350);
  const tipSet = page.locator('[data-slot="tooltip-content"]');
  console.log("SF_TIP_SET:", JSON.stringify({ text: (await tipSet.textContent() ?? "").trim() }));
  await page.mouse.move(10, 300);
  await page.waitForTimeout(250);

  // ---- 折叠态：纵排、版本行卸载、钮仍 30×30 ----
  await sidebar.getByRole("button", { name: "收起侧栏" }).click();
  await page.waitForTimeout(400);
  console.log("SF_COLLAPSED:", JSON.stringify(await sidebar.evaluate((el) => {
    const footEl = el.querySelector(":scope > div:last-child");
    const fcs = footEl ? getComputedStyle(footEl) : null;
    const verEl = el.querySelector("span.ml-auto");
    return {
      footDirection: fcs?.flexDirection,
      footPadding: fcs ? `${fcs.paddingTop} ${fcs.paddingRight} ${fcs.paddingBottom} ${fcs.paddingLeft}` : null,
      verMounted: verEl !== null,
      btnHeight: el.querySelector("button svg.lucide-power")?.parentElement?.offsetHeight ?? null,
    };
  }), null, 2));
  await sidebar.getByRole("button", { name: "展开侧栏" }).click();
  await page.waitForTimeout(400);

  // ---- 暗色（dsf-theme=dark → html.dark）：侧栏底（对齐批在案：实现 n-75 暗 9% vs 规范 n-50）----
  // 注意：暗色下主题钮图标随 mode 变为 lucide-moon（亮色场景才是 lucide-monitor）。
  await page.evaluate(() => localStorage.setItem("dsf-theme", "dark"));
  await page.reload();
  await page.getByRole("button", { name: "策略", exact: true }).click();
  await page.getByRole("textbox").first().waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(400);
  console.log("SF_DARK:", JSON.stringify(await Promise.all([
    sidebar.evaluate((el) => ({ sidebarBg: getComputedStyle(el).backgroundColor })),
    foot.evaluate((el) => ({ borderTopColor: getComputedStyle(el).borderTopColor })),
    btnSd.evaluate((el) => ({ sdColor: getComputedStyle(el).color })),
    ver.evaluate((el) => ({ verColor: getComputedStyle(el).color, dotBg: getComputedStyle(el.querySelector("span")).backgroundColor })),
  ]).then(([s, f, d, v]) => ({ ...s, ...f, ...d, ...v })), null, 2));
  const darkTheme = sidebar.locator("button:has(svg.lucide-moon)");
  await darkTheme.hover();
  await page.waitForTimeout(350);
  console.log("SF_DARK_HOVER_THEME:", JSON.stringify(await darkTheme.evaluate((el) => ({
    backgroundColor: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color,
  })), null, 2));
  const darkTip = page.locator('[data-slot="tooltip-content"]');
  await darkTip.waitFor({ state: "visible", timeout: 5000 });
  console.log("SF_DARK_TIP_THEME:", JSON.stringify({ text: (await darkTip.textContent() ?? "").trim() }));
  await page.mouse.move(10, 300);
});

// 零件取证 · 侧栏版本行（sidebar-version）computed style 实测（同一 CMP_CAPTURE=1 门）。
// 四态全实测（E2E 环境裸服务 /api/service=409 → 默认场景即 bad）：bad（绿对红）→ ok（路由闸放 200）
// → probing（路由闸延迟 3s，挂载初期悬空）→ stopping（dispatch df:service-stopping）→ 暗色（点不翻转）。
test("measure sidebar-version computed styles", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // 服务状态闸：fail = 放行真 409（bad 态）；ok = 200；slow = 延迟 3s 再 200（probing 态可测窗口）
  let svcMode: "fail" | "ok" | "slow" = "fail";
  await page.route("**/api/service", async (route) => {
    if (svcMode === "slow") {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return;
    }
    if (svcMode === "ok") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return;
    }
    await route.continue();
  });
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await page.getByRole("button", { name: "策略", exact: true }).click();
  await page.getByRole("textbox").first().waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(600);

  const sidebar = page.getByTestId("sidebar");
  const ver = sidebar.locator("span.ml-auto");
  const dot = ver.locator('[role="img"]');
  const dotState = (el: HTMLElement): Record<string, string | number> => {
    const cs = getComputedStyle(el);
    return {
      width: cs.width, height: cs.height, borderRadius: cs.borderRadius,
      backgroundColor: cs.backgroundColor, animationName: cs.animationName,
    };
  };

  // ---- bad 态（裸服务 409）----
  console.log("SV_BAD:", JSON.stringify(await dot.evaluate(dotState), null, 2));
  console.log("SV_BAD_ARIA:", JSON.stringify({ ariaLabel: await dot.getAttribute("aria-label") }));
  console.log("SV_VER:", JSON.stringify(await ver.evaluate(SF_VER), null, 2));
  console.log("SV_TEXT:", JSON.stringify({ text: (await ver.textContent() ?? "").trim() }));
  await dot.hover();
  await page.waitForTimeout(350);
  const tipBad = page.locator('[data-slot="tooltip-content"]');
  await tipBad.waitFor({ state: "visible", timeout: 5000 });
  console.log("SV_BAD_TIP:", JSON.stringify({ text: (await tipBad.textContent() ?? "").trim() }));
  await page.mouse.move(10, 300);
  await page.waitForTimeout(250);

  // ---- ok 态（闸放 200 → 重挂载探测通）----
  svcMode = "ok";
  await page.reload();
  await page.getByRole("button", { name: "策略", exact: true }).click();
  await page.getByRole("textbox").first().waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(800);
  const okDot = sidebar.locator("span.ml-auto").locator('[role="img"]');
  console.log("SV_OK:", JSON.stringify(await okDot.evaluate(dotState), null, 2));
  console.log("SV_OK_ARIA:", JSON.stringify({ ariaLabel: await okDot.getAttribute("aria-label") }));
  await okDot.hover();
  await page.waitForTimeout(350);
  const tipOk = page.locator('[data-slot="tooltip-content"]');
  await tipOk.waitFor({ state: "visible", timeout: 5000 });
  console.log("SV_OK_TIP:", JSON.stringify({ text: (await tipOk.textContent() ?? "").trim() }));
  await page.mouse.move(10, 300);
  await page.waitForTimeout(250);

  // ---- probing 态（闸延迟 3s：挂载后探测悬空——瞬态窗口实测）----
  svcMode = "slow";
  await page.reload();
  await page.getByRole("button", { name: "策略", exact: true }).click();
  await page.getByRole("textbox").first().waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(500);
  const probeDot = sidebar.locator("span.ml-auto").locator('[role="img"]');
  console.log("SV_PROBING:", JSON.stringify(await probeDot.evaluate(dotState), null, 2));
  console.log("SV_PROBING_ARIA:", JSON.stringify({ ariaLabel: await probeDot.getAttribute("aria-label") }));

  // ---- stopping 态（关机受理事件 → 蓝点呼吸；探测闸改回 ok，重查不放红）----
  svcMode = "ok";
  await page.evaluate(() => window.dispatchEvent(new Event("df:service-stopping")));
  await page.waitForTimeout(300);
  console.log("SV_STOPPING:", JSON.stringify(await probeDot.evaluate(dotState), null, 2));
  console.log("SV_STOPPING_ARIA:", JSON.stringify({ ariaLabel: await probeDot.getAttribute("aria-label") }));
  await page.mouse.move(10, 300);
  await page.waitForTimeout(250);

  // ---- 折叠态：版本行整行卸载 ----
  await sidebar.getByRole("button", { name: "收起侧栏" }).click();
  await page.waitForTimeout(400);
  console.log("SV_COLLAPSED:", JSON.stringify({ verMounted: (await ver.count()) > 0 }));
  await sidebar.getByRole("button", { name: "展开侧栏" }).click();
  await page.waitForTimeout(400);

  // ---- 暗色：点色档不翻转（语义点无暗色变体），文字色随 tokens 翻转 ----
  await page.evaluate(() => localStorage.setItem("dsf-theme", "dark"));
  await page.reload();
  await page.getByRole("button", { name: "策略", exact: true }).click();
  await page.getByRole("textbox").first().waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(600);
  const darkVer = sidebar.locator("span.ml-auto");
  console.log("SV_DARK:", JSON.stringify(await darkVer.evaluate((el) => {
    const dotEl = el.querySelector("span");
    return {
      verColor: getComputedStyle(el).color,
      dotBg: dotEl ? getComputedStyle(dotEl).backgroundColor : null,
    };
  }), null, 2));
});
