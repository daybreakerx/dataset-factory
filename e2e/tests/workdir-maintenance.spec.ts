import { expect, test } from "@playwright/test";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { isolatedBaseURL } from "./fixtures/isolated-servers";

// 本文件打真后端，用自己那份服务与数据根：迁移/删除的维护锁也落在自己的数据根里，
// 不会被别的文件的操作撞上。
test.use({ baseURL: isolatedBaseURL("workdir-maintenance.spec.ts") });

test("工作目录迁移经界面确认后保留素材与快照并更新登记", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  const source = testInfo.outputPath("original");
  // 新流程选的是目标目录本体（不再由前端「父目录＋原名」拼出来）。
  const target = testInfo.outputPath("renamed-parent");
  await mkdir(source, { recursive: true });
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
  await writeFile(path.join(source, "sample.png"), bytes);
  const create = await request.post("/api/workdirs", { data: { path: source, title: "迁移验证" } });
  expect(create.status()).toBe(202);
  const accepted = await create.json();
  const wid = accepted.workdir.id;
  await expect.poll(async () => (await (await request.get(`/api/tasks/${accepted.task_id}`)).json()).status).toBe("succeeded");
  const prompts = await (await request.get("/api/prompts")).json();
  const batch = await request.post(`/api/workdirs/${wid}/batches`, { data: { type: "scratch", name: "迁移验证", endpoint_id: ((await (await request.get("/api/endpoints")).json()).find((e) => e.name === "default")?.id ?? "default"), prompt_id: prompts[0].id, skill_ids: [] } });
  expect(batch.ok()).toBeTruthy();
  const snapshot = await readFile(path.join(source, ".dsf", "strategies", "s1.json"));
  const moves: unknown[] = [];
  const errors: string[] = [];
  page.on("request", (req) => { if (req.method() === "POST" && req.url().endsWith("/relocate")) moves.push(req.postDataJSON()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "打标", exact: true }).click();
  await page.getByRole("button", { name: "选择工作目录与批次" }).click();
  await page.getByRole("button", { name: "工作目录设置 迁移验证", exact: true }).click();
  await expect(page.getByRole("region", { name: "工作目录设置", exact: true })).toBeVisible();
  // 「素材 N · 产物 M」这一段来自 stats 异步请求：弹窗一打开只有路径，CI 冷启动首访
  // 实测 5 秒默认预算内还没到（run 35433472710 报错正文：Locator 解析到了 section、
  // 14 次重试都只读到「基本信息路径…」）。与同文件迁移状态断言同口径放宽到 30 秒，断言内容一字未改。
  await expect(page.getByRole("region", { name: "基本信息" })).toContainText("素材 1 · 产物 0", {
    timeout: 30_000,
  });
  expect(await (await request.get(`/api/workdirs/${wid}/stats`)).json()).toEqual({ asset_count: 1, asset_bytes: bytes.length });
  await expect(page.getByText("产物 0 / 1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "改名策略 迁移验证", exact: true }).click();
  const rename = page.getByRole("textbox", { name: "策略名称 s1" });
  await rename.fill("迁移改名");
  await rename.press("Enter");
  await expect(page.getByRole("button", { name: "改名策略 迁移改名", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "新增策略", exact: true }).click();
  const strategyDialog = page.getByRole("dialog", { name: "新增策略", exact: true });
  await strategyDialog.getByRole("textbox", { name: "策略名", exact: true }).fill("设置新增");
  await strategyDialog.getByRole("button", { name: "创建策略", exact: true }).click();
  await expect(strategyDialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "改名策略 设置新增", exact: true })).toBeVisible();
  expect((await request.get(`/api/workdirs/${wid}/batches/s2/runs/current`)).status()).toBe(200); // L3：空闲 = 200 + null
    expect(await (await request.get(`/api/workdirs/${wid}/batches/s2/runs/current`)).json()).toBeNull();
  await page.getByRole("button", { name: "返回主页面", exact: true }).click();
  await page.getByRole("button", { name: "选择工作目录与批次" }).click();
  await page.getByRole("button", { name: "新增策略 迁移验证", exact: true }).click();
  await expect(strategyDialog).toBeVisible();
  await strategyDialog.getByRole("textbox", { name: "策略名", exact: true }).fill("下拉新增");
  await expect(strategyDialog.getByRole("button", { name: "创建策略", exact: true })).toHaveCSS("color", "rgb(255, 255, 255)");
  const overlay = page.locator('[data-slot="dialog-overlay"]');
  await expect(overlay).toHaveCSS("background-color", /^(rgba\(0, 0, 0, 0\.32\)|oklab\(0 0 0 \/ 0\.32\))$/);
  await page.screenshot({ path: testInfo.outputPath("new-strategy.png"), animations: "disabled" });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await expect(overlay).toHaveCSS("background-color", /^(rgba\(0, 0, 0, 0\.55\)|oklab\(0 0 0 \/ 0\.55\))$/);
  await expect(strategyDialog.getByRole("button", { name: "创建策略", exact: true })).toHaveCSS("color", "rgb(255, 255, 255)");
  await page.screenshot({ path: testInfo.outputPath("new-strategy-dark.png"), animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await strategyDialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(15);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
  await page.screenshot({ path: testInfo.outputPath("new-strategy-mobile.png"), animations: "disabled" });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await strategyDialog.getByRole("button", { name: "创建策略", exact: true }).click();
  await expect(strategyDialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "选择工作目录与批次" })).toContainText("下拉新增");
  const batchList = await (await request.get(`/api/workdirs/${wid}/batches`)).json();
  expect(batchList.map((entry: { id: string; name: string }) => [entry.id, entry.name])).toEqual([["s1", "迁移改名"], ["s2", "设置新增"], ["s3", "下拉新增"]]);
  expect((await request.get(`/api/workdirs/${wid}/batches/s3/runs/current`)).status()).toBe(200); // L3：空闲 = 200 + null
  expect(JSON.parse(await readFile(path.join(source, ".dsf", "strategies", "s3.json"), "utf8"))).toHaveProperty("prompt");
  await page.getByRole("button", { name: "选择工作目录与批次" }).click();
  await page.getByRole("button", { name: "工作目录设置 迁移验证", exact: true }).click();
  await expect(page.getByRole("button", { name: "修改路径", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "修改路径", exact: true }).click();
  // 弹窗＝#20 目录选择弹窗直接承载（没有中间表单层）：标题行给迁移主体与琥珀句。
  const dialog = page.getByRole("dialog", { name: "修改路径", exact: true });
  await expect(dialog.getByText(`当前：${source}`, { exact: true })).toBeVisible();
  await expect(dialog.getByText("迁移后原目录将删除。")).toBeVisible();
  const primary = dialog.getByRole("button", { name: "迁移到此目录" });
  // 「要求目标为空」＝组件能力参数：非空浏览位主钮不亮＋title 给原因（稿格 2）。
  await expect(primary).toBeDisabled();
  await expect(primary).toHaveAttribute(
    "title",
    "迁移目标目录必须为空——请选中一个空文件夹，或进入一个空文件夹。",
  );
  await expect(dialog).toHaveCSS("width", "620px");
  await page.screenshot({ path: testInfo.outputPath("directory-picker.png"), animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  const pickerBounds = await dialog.boundingBox();
  expect(pickerBounds!.x).toBeGreaterThanOrEqual(15);
  expect(pickerBounds!.x + pickerBounds!.width).toBeLessThanOrEqual(375);
  await page.screenshot({ path: testInfo.outputPath("directory-picker-mobile.png"), animations: "disabled" });
  await page.setViewportSize({ width: 1280, height: 720 });
  await dialog.getByRole("textbox", { name: "服务器路径" }).fill(testInfo.outputPath());
  await dialog.getByRole("button", { name: "跳转", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "original", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "新建目录", exact: true }).click();
  await dialog.getByRole("textbox", { name: "目录名称", exact: true }).fill("new-parent");
  await dialog.getByRole("button", { name: "创建", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "服务器路径" })).toHaveValue(
    testInfo.outputPath("new-parent"),
  );
  expect((await stat(testInfo.outputPath("new-parent"))).isDirectory()).toBeTruthy();
  await dialog.getByRole("button", { name: "上一级" }).click();
  // 单击＝选中，能力行的「重命名」钮随选中现；改名在原地输入框里提交（Enter）。
  await dialog.getByRole("button", { name: "new-parent", exact: true }).click();
  await dialog.getByRole("button", { name: "重命名", exact: true }).click();
  const draft = dialog.getByRole("textbox", { name: "重命名 new-parent", exact: true });
  await draft.fill("renamed-parent");
  await draft.press("Enter");
  await expect(dialog.getByRole("textbox", { name: "服务器路径" })).toHaveValue(target);
  await expect(stat(testInfo.outputPath("new-parent"))).rejects.toThrow();
  // 改名后已站在空目录里：以当前所在目录为目标，主钮亮。
  await expect(primary).toBeEnabled();
  await primary.click();
  // 迁移是「复制 + 逐文件回读校验」的后台任务，界面那条状态行要等它跑完才出现。
  // 默认 5s 在整条门禁连跑（前面刚跑完 pytest / Vitest / 构建）时不够用，实测同一份代码
  // 单跑必过、跟在门禁后面偶发不出现（2026-09-19 三次 in-suite 失败均是等待预算不足，
  // 报错都是 element(s) not found 而非迁移失败）。放宽等待，断言内容与后面的磁盘核对一字未改。
  // 2026-09-21 再放宽到 60s：in-suite 跑时迁移任务与并行 worker 抢 CPU，「正在迁移 · 0%」
  // 卡 30s 的形态与 2026-09-19 相同（等待预算不足，非迁移失败）。
  await expect(dialog).toContainText("已迁移到", {
    timeout: 60_000,
  });
  expect(moves).toEqual([{ path: target }]);
  expect(await readFile(path.join(target, "sample.png"))).toEqual(bytes);
  expect(await readFile(path.join(target, ".dsf", "strategies", "s1.json"))).toEqual(snapshot);
  await expect(stat(source)).rejects.toThrow();
  const info = await (await request.get(`/api/workdirs/${wid}`)).json();
  expect(info.id).toBe(wid);
  expect(info.path).toBe(target);
  await dialog.getByRole("button", { name: "关闭", exact: true }).first().click();
  await expect(page.getByRole("region", { name: "基本信息" })).toContainText(target);
  await writeFile(path.join(target, "s1__lost.txt"), "orphan caption");
  await writeFile(path.join(target, "s1__other.txt"), "retained caption");
  await writeFile(path.join(target, "design.psd"), "unsupported source");
  await page.getByRole("button", { name: "查看无效文件清单", exact: true }).click();
  const cleanup = page.getByRole("dialog", { name: "清理无效文件", exact: true });
  // 只读扫场（稿三改）：三类各一表、无勾选框，页脚「取消／全部清理」一步执行（九改撤二次确认）。
  await expect(cleanup.getByText("无配对产物", { exact: true })).toBeVisible();
  await expect(cleanup.getByText("不支持的文件", { exact: true })).toBeVisible();
  expect(cleanup.getByRole("checkbox")).toHaveCount(0);
  expect(await readFile(path.join(target, "s1__lost.txt"), "utf8")).toBe("orphan caption");
  await cleanup.getByRole("button", { name: "全部清理", exact: true }).click();
  // 清理是带进度的长任务：进度到 100% 即自动关窗（十改），数量去向由宿主「清理」行承接。
  await expect(cleanup).toHaveCount(0);
  await expect(page.getByRole("region", { name: "基本信息" })).toContainText("无效文件：0 个");
  await expect(stat(path.join(target, "s1__lost.txt"))).rejects.toThrow();
  await expect(stat(path.join(target, "s1__other.txt"))).rejects.toThrow();
  await expect(stat(path.join(target, "design.psd"))).rejects.toThrow();
  expect(await readFile(path.join(target, "sample.png"))).toEqual(bytes);
  const deletes: unknown[] = [];
  page.on("request", (req) => { if (req.method() === "DELETE" && req.url().endsWith(`/workdirs/${wid}`)) deletes.push(req.postDataJSON()); });
  await page.getByRole("button", { name: "删除工作目录", exact: true }).click();
  const deletion = page.getByRole("dialog", { name: /^删除工作目录/u });
  await expect(deletion).toContainText(target);
  expect(deletes).toEqual([]);
  expect((await stat(target)).isDirectory()).toBeTruthy();
  await deletion.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(deletion).toHaveCount(0);
  expect(deletes).toEqual([{ confirmed_path: target }]);
  await expect(stat(target)).rejects.toThrow();
  expect((await request.get(`/api/workdirs/${wid}`)).status()).toBe(404);
  await expect(page.getByRole("region", { name: "工作目录设置", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("workdir-settings.png"), fullPage: true, animations: "disabled" });
});
