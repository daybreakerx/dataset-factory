import { expect, test } from "@playwright/test";
import { mockLongNameFixtures } from "./fixtures/labeling-stubs";

test("打标页长名称下顶栏与条目列保持原型尺寸和对齐", async ({ page }, testInfo) => {
  await mockLongNameFixtures(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "打标", exact: true }).click();
  await expect(page.getByRole("button", { name: "sample.jpg", exact: true })).toBeVisible();

  const column = page.getByRole("complementary", { name: "素材条目" });
  const selector = page.getByRole("button", { name: "选择工作目录与批次" });
  const create = page.getByRole("button", { name: "新建批次", exact: true });
  const search = page.getByRole("textbox", { name: "搜索条目" });
  const bounds = await Promise.all([column.boundingBox(), selector.boundingBox(), create.boundingBox(), search.locator("..").boundingBox()]);
  const [listBox, selectorBox, createBox, searchBox] = bounds;
  if (!listBox || !selectorBox || !createBox || !searchBox) throw new Error("缺少布局元素");
  expect(listBox.width).toBe(320);
  expect(selectorBox.x).toBe(listBox.x);
  expect(selectorBox.height).toBe(34);
  expect(createBox.height).toBe(34);
  expect(createBox.width).toBe(34);
  expect(createBox.x + createBox.width).toBe(listBox.x + listBox.width - 12);
  // 搜索框统一 §8 .search 高版（2026-10-06 用户裁「仍统一高版、不立密集档」）＝34。
  expect(searchBox.height).toBe(34);
  expect(selectorBox.x + selectorBox.width).toBeLessThan(createBox.x);
  const context = page.getByRole("region", { name: "策略配置" });
  // 2026-09-21 定形：健康信息移入自研气泡，章内文本 = 「端点 · 模型」——
  // 按文本定位后取父级章容器做尺寸断言（可读名来自 base_url 域名）。
  const endpoint = context.getByText("Example · caption-model", { exact: true }).locator("..");
  await expect(endpoint).toBeVisible();
  await expect(endpoint).toHaveCSS("height", "26px");
  await expect(endpoint).toHaveCSS("border-radius", "12px");
  await expect(endpoint).toHaveCSS("border-top-width", "0px");
  expect((await context.boundingBox())?.x).toBe(listBox.x + listBox.width + 16);
  expect((await page.getByRole("region", { name: "条目汇总" }).locator("dl").boundingBox())?.width).toBe(460);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("labeling-desktop.png"), fullPage: true });

  await page.getByRole("button", { name: "已完成 1", exact: true }).click();
  await expect(page.getByRole("button", { name: "sample.jpg", exact: true })).not.toBeVisible();
  await search.fill("sample");
  await expect(page.getByRole("button", { name: "sample.jpg", exact: true })).toBeVisible();
  await page.route("**/items/sample/txt", (route) => route.fulfill({ contentType: "text/plain", body: "A sample caption." }));
  await page.route("**/items/sample/asset", (route) => route.fulfill({
    contentType: "image/png",
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"),
  }));
  await page.getByRole("button", { name: "sample.jpg", exact: true }).click();
  const image = page.getByRole("img", { name: "sample.jpg" });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1);
  await expect(page.getByText("A sample caption.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "折叠为小图" }).click();
  // 折叠态＝§22 .stage-mini 40×40（稿「条目预览媒体舞台」格③；旧实现是 76px 通栏小图带）。
  // 图片外面那层是开大图的按钮（⑦键盘可达），量几何要量舞台本身。
  const stage = image.locator("..").locator("..");
  expect((await stage.boundingBox())?.height).toBe(40);
  await page.screenshot({ path: testInfo.outputPath("labeling-preview-folded.png"), fullPage: true });
  await page.getByRole("button", { name: "展开素材" }).click();
  expect((await stage.boundingBox())?.height).toBe(384);
  await page.getByRole("button", { name: "返回概览" }).click();
  await expect(image).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  // 窄屏（<768）默认收起＝左列不占位、画布满宽；出口是画布大题行最左的展开钮（稿 §22）。
  await expect(column).toBeHidden();
  const listToggle = page.getByRole("button", { name: "展开条目列表" });
  await expect(listToggle).toBeVisible();
  const mobileCreate = await create.boundingBox();
  if (!mobileCreate) throw new Error("缺少窄屏布局元素");
  expect(mobileCreate.x + mobileCreate.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await listToggle.click();
  await expect(column).toBeVisible();
  expect((await column.boundingBox())?.width).toBe(320);
  await page.getByRole("button", { name: "收起列表" }).click();
  await expect(column).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("labeling-mobile.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("打标页顶栏窄屏三段：折行、反馈行图标档、极窄档收缩下限", async ({ page }) => {
  await mockLongNameFixtures(page);
  // 发车即失败：组内多出一行红字反馈行，把本组撑到触发件列渐缩该起作用的那一带。
  // 桩文案取稿样图那句（12 字）——反馈行走 nowrap，长句会把本组撑出容器（溢出实测的
  // 责任在文案长度不在布局，稿侧探针同样以样本文案定阈）。
  await page.route("**/batches/s1/runs", (route) =>
    route.fulfill({ status: 500, json: { detail: "运行失败，请查看运行日志。" } }),
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "打标", exact: true }).click();

  const topbar = page.locator('section[aria-label="打标"]');
  const leftCell = topbar.locator("> header > div").first();
  const chain = page.getByRole("region", { name: "策略配置" });
  const group = page.getByRole("region", { name: "运行控制" });
  // 容器查询量的是**内容盒**宽（clientWidth 含内距），档位判断要用这一把尺；
  // 读数（容器宽/内容盒宽/页面 scrollWidth）都要等「连续多帧不变」才取值——视口切换
  // 会连带 React 异步提交与 CSS 宽度过渡（如 768–1024 档侧栏自动收起 150ms），
  // resize 后立即读会拿到提交前的旧值或过渡中间值（假收敛的根源）。
  const readSettled = async (): Promise<{
    container: number;
    content: number;
    scrollWidth: number;
  }> =>
    topbar.evaluate(async (element) => {
      const measure = () => {
        const style = getComputedStyle(element);
        return {
          container: element.clientWidth,
          content:
            element.clientWidth -
            parseFloat(style.paddingLeft) -
            parseFloat(style.paddingRight),
          scrollWidth: document.documentElement.scrollWidth,
        };
      };
      let last = measure();
      let stableFrames = 0;
      for (let frame = 0; frame < 240 && stableFrames < 8; frame += 1) {
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
        const now = measure();
        stableFrames =
          now.container === last.container &&
          now.content === last.content &&
          now.scrollWidth === last.scrollWidth
            ? stableFrames + 1
            : 0;
        last = now;
      }
      return last;
    });
  // 阈值量的是容器宽（顶栏挂 @container lbctx 的那层），不是视口宽——侧栏与内距都在外面扣掉，
  // 容器宽随视口变（桌面视口扣侧栏、窄屏视口恒等视口）。按「稳定后的容器宽」迭代补差。
  let offset = 1440 - (await readSettled()).container;
  const setContainerWidth = async (target: number): Promise<void> => {
    for (let step = 0; step < 8; step += 1) {
      await page.setViewportSize({ width: target + offset, height: 900 });
      const actual = (await readSettled()).container;
      if (actual === target) return;
      offset += target - actual;
    }
    throw new Error(`容器宽未收敛到 ${target}（最后读到 ${(await readSettled()).container}）`);
  };
  const noOverflow = async (): Promise<void> => {
    const viewport = page.viewportSize();
    if (!viewport) throw new Error("缺少视口");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
      viewport.width,
    );
  };
  await group.getByRole("button", { name: "开始打标" }).click();
  const alert = group.getByRole("alert");
  await expect(alert).toBeVisible();

  // 段一·非折行（稿 874 自然点的右侧）：一行装下全部，触发件列锁 320。
  await setContainerWidth(880);
  expect((await leftCell.boundingBox())?.width).toBe(320);
  const [wideChain, wideGroup] = [await chain.boundingBox(), await group.boundingBox()];
  if (!wideChain || !wideGroup) throw new Error("缺少顶栏元素");
  expect(Math.abs(wideChain.y + wideChain.height / 2 - (wideGroup.y + wideGroup.height / 2))).toBeLessThan(2);
  await noOverflow();

  // 段二·折行（<874）：右段 display:contents——本组钉第一行右缘，胶囊串掉第二行跨整行。
  await setContainerWidth(860);
  const [foldChain, foldGroup, foldLeft] = [
    await chain.boundingBox(),
    await group.boundingBox(),
    await leftCell.boundingBox(),
  ];
  if (!foldChain || !foldGroup || !foldLeft) throw new Error("缺少顶栏元素");
  expect(foldChain.y).toBeGreaterThan(foldGroup.y + foldGroup.height);
  expect(foldChain.x).toBe(foldLeft.x);
  expect(foldChain.x + foldChain.width).toBeGreaterThan(foldGroup.x);
  expect(foldLeft.width).toBeGreaterThanOrEqual(240);
  expect(foldLeft.width).toBeLessThanOrEqual(320);
  const foldTopbar = await topbar.boundingBox();
  if (!foldTopbar) throw new Error("缺少顶栏容器");
  expect(foldGroup.x + foldGroup.width).toBeLessThanOrEqual(
    foldTopbar.x + foldTopbar.width,
  );
  await noOverflow();

  // 段三·反馈行图标档（512–663）：文字隐、14px 图标显（全文进 aria-label）、组内间距收到 8。
  // 桌面视口到不了这一档：侧栏两态把 ≥768 视口的容器宽最低顶在 704（768 收起态），跨不进 663；
  // 改用窄屏视口 600——<768 视口侧栏不占位、容器宽＝视口，图标档可稳定到达。
  await page.setViewportSize({ width: 600, height: 900 });
  // 先把「确实进了图标档」当断言前提钉住：红了能当场指认是没进到那一档、还是档位行为不对。
  const tierWidth = (await readSettled()).content;
  expect(tierWidth).toBeGreaterThan(512);
  expect(tierWidth).toBeLessThan(663);
  await expect(chain.getByText("Example · caption-model")).toBeVisible();
  await expect(alert.getByText("运行失败，请查看运行日志。")).toBeHidden();
  await expect(
    alert.getByRole("img", { name: "运行失败，请查看运行日志。" }),
  ).toBeVisible();
  await expect(group).toHaveCSS("gap", "8px");
  await expect(group.getByRole("button", { name: "开始打标" })).toBeVisible();
  await noOverflow();

  // 段四·极窄档（<512，手机视口）：触发件列恒 240 不回涨、本组仍可完整容下。
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await readSettled()).container).toBeLessThan(512);
  expect((await leftCell.boundingBox())?.width).toBe(240);
  const tinyGroup = await group.boundingBox();
  const tinyTopbar = await topbar.boundingBox();
  if (!tinyGroup || !tinyTopbar) throw new Error("缺少顶栏元素");
  expect(tinyGroup.x + tinyGroup.width).toBeLessThanOrEqual(
    tinyTopbar.x + tinyTopbar.width,
  );
  await noOverflow();
  expect(errors).toEqual([]);
});
