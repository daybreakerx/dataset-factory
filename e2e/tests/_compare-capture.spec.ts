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
