/**
 * 页面状态保持 E2E：切页往返零重置 + reload 模拟重启。
 *
 * 与组件测试的分工：组件测试在 jsdom 里验证「机制」（Activity 保活、镜像优先级、
 * 失效回退）；这里在真实浏览器里验证「体验」——编辑草稿、对话输入、打标筛选词
 * 在切页与重启后确实还在，隐藏页以 display:none 常驻 DOM，重启直达上次页面。
 */
import { expect, test } from "@playwright/test";
import { isolatedBaseURL, isolatedFakeLlmURL } from "./fixtures/isolated-servers";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// 本文件打真后端，用自己那份服务与数据根（隔离口径与其余 spec 相同）。
test.use({ baseURL: isolatedBaseURL("page-state.spec.ts") });

test.describe("页面状态保持", () => {
  test("编辑草稿与对话输入跨切页保留，切走的页隐藏常驻 DOM", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("名称", { exact: true }).fill("跨页草稿");
    await page.getByLabel("描述", { exact: true }).fill("切页不应丢我");
    await page.getByLabel("打标指令").fill("切页还在的一句话");

    await page.getByRole("button", { name: "打标", exact: true }).click();
    await expect(page.getByTestId("page-labeling")).toBeVisible();
    // 保活的直接证据：切走后策略页仍 attached（display:none），不再是卸载重挂。
    await expect(page.getByTestId("page-prompts")).toBeAttached();
    await expect(page.getByTestId("page-prompts")).not.toBeVisible();

    await page.getByRole("button", { name: "策略", exact: true }).click();
    await expect(page.getByLabel("名称", { exact: true })).toHaveValue("跨页草稿");
    await expect(page.getByLabel("描述", { exact: true })).toHaveValue("切页不应丢我");
    await expect(page.getByLabel("打标指令")).toHaveValue("切页还在的一句话");
  });

  test("打标页筛选词跨切页保留", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "打标", exact: true }).click();
    await expect(page.getByTestId("page-labeling")).toBeVisible();
    await page.getByPlaceholder("搜索条目").fill("过滤词");

    await page.getByRole("button", { name: "策略", exact: true }).click();
    await page.getByRole("button", { name: "打标", exact: true }).click();

    await expect(page.getByPlaceholder("搜索条目")).toHaveValue("过滤词");
  });

  test("reload 模拟重启：直达上次页面，筛选词与编辑草稿恢复", async ({ page }) => {
    await page.goto("/");
    // 先在策略页留一份编辑器草稿（进镜像），再切到打标页留下筛选词与「上次页面」。
    await page.getByLabel("名称", { exact: true }).fill("重启草稿");
    await page.getByRole("button", { name: "打标", exact: true }).click();
    await expect(page.getByTestId("page-labeling")).toBeVisible();
    await page.getByPlaceholder("搜索条目").fill("重启后还在");

    await page.reload();

    // 重启直达上次停留的页面（打标），筛选词从 localStorage 恢复。
    await expect(page.getByTestId("page-labeling")).toBeVisible();
    await expect(page.getByPlaceholder("搜索条目")).toHaveValue("重启后还在");

    // 首次进入策略页：编辑器从镜像恢复（重启前写下的草稿原样回来）。
    await page.getByRole("button", { name: "策略", exact: true }).click();
    await expect(page.getByTestId("page-prompts")).toBeVisible();
    await expect(page.getByLabel("名称", { exact: true })).toHaveValue("重启草稿");
  });

  test("策略会话跨重启：策略选中恢复、对话接续、切走再切回不丢（v3）", async ({ page }) => {
    await page.goto("/");
    // 建提示词 → 存 → 建策略 → 存 → 下拉点选应用 → 发消息等回复。
    await page.getByRole("button", { name: "切换提示词" }).click();
    await page.getByRole("button", { name: "新建提示词" }).click();
    await page.getByLabel("名称", { exact: true }).fill("状态保持策略提示词");
    await page.getByLabel("正文（Markdown）").fill("客观描述可见画面。");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByText("已保存", { exact: true })).toBeVisible();
    // 策略保存冻结端点、对话请求显式携带端点（全局激活退役）：先在 chip 选中种子端点。
    await page.getByRole("button", { name: "端点配置切换器" }).click();
    await page.getByRole("menu").getByRole("menuitem", { name: /^default/ }).click();
    await page.getByLabel("策略名称", { exact: true }).fill("E2E 状态策略");
    // 实时保存改版（2026-10-04 裁）：新建走「创建」钮，撤了「保存策略」。
    await page.getByRole("button", { name: "创建", exact: true }).click();
    await page.getByRole("button", { name: "切换策略" }).click();
    await page.getByRole("menuitem", { name: /^E2E 状态策略/ }).click();
    await page.getByLabel("打标指令").fill("策略会话第一句");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByText("E2E 假模型的打标结果").last()).toBeVisible({
      timeout: 15_000,
    });

    await page.reload();

    // 用户实测场景：重启后策略仍是「E2E 状态策略」，对话历史挂在它下面。
    await expect(page.getByLabel("策略名称", { exact: true })).toHaveValue(
      "E2E 状态策略",
    );
    await expect(page.getByText("E2E 假模型的打标结果").last()).toBeVisible();

    // 切走（新建策略 = 进草稿桶）→ 草稿桶还没有会话，空白。
    await page.getByRole("button", { name: "切换策略" }).click();
    await page.getByRole("button", { name: "新建策略" }).click();
    await expect(page.getByText(/暂无消息/)).toBeVisible();

    // 切回 → 进该策略的桶接续它的最近会话，历史回来。
    await page.getByRole("button", { name: "切换策略" }).click();
    await page.getByRole("menuitem", { name: /^E2E 状态策略/ }).click();
    await expect(page.getByText("E2E 假模型的打标结果").last()).toBeVisible();
  });

  test("每策略各自的最近会话；新建策略的对话不错绑到已有策略（v3）", async ({ page }) => {
    await page.goto("/");
    // 建提示词 → 两条策略共用它（共用提示词正是 v2 签名错绑的温床）。
    await page.getByRole("button", { name: "切换提示词" }).click();
    await page.getByRole("button", { name: "新建提示词" }).click();
    await page.getByLabel("名称", { exact: true }).fill("归属隔离提示词");
    await page.getByLabel("正文（Markdown）").fill("客观描述可见画面。");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByText("已保存", { exact: true })).toBeVisible();
    // 策略保存冻结端点、对话请求显式携带端点（全局激活退役）：先在 chip 选中种子端点。
    await page.getByRole("button", { name: "端点配置切换器" }).click();
    await page.getByRole("menu").getByRole("menuitem", { name: /^default/ }).click();

    // 策略 A：新建 → 填名 → 创建 → 应用 → 发言。（boot 可能认领了上条 test 的策略——
    // 「创建」钮只在新建态渲染，先显式点「新建策略」离开选中态；实时保存改版后无保存钮。）
    await page.getByRole("button", { name: "切换策略" }).click();
    await page.getByRole("button", { name: "新建策略" }).click();
    await page.getByLabel("策略名称", { exact: true }).fill("桶隔离A");
    await page.getByRole("button", { name: "创建", exact: true }).click();
    await page.getByRole("button", { name: "切换策略" }).click();
    await page.getByRole("menuitem", { name: /^桶隔离A/ }).click();
    await page.getByLabel("打标指令").fill("A 的第一句");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByText("E2E 假模型的打标结果").last()).toBeVisible({
      timeout: 15_000,
    });

    // 策略 B：新建（进草稿桶）→ 保存 → 应用 → 发言。
    await page.getByRole("button", { name: "切换策略" }).click();
    await page.getByRole("button", { name: "新建策略" }).click();
    await page.getByLabel("策略名称", { exact: true }).fill("桶隔离B");
    await page.getByRole("button", { name: "创建", exact: true }).click();
    await page.getByRole("button", { name: "切换策略" }).click();
    await page.getByRole("menuitem", { name: /^桶隔离B/ }).click();
    await page.getByLabel("打标指令").fill("B 的第一句");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByText("E2E 假模型的打标结果").last()).toBeVisible({
      timeout: 15_000,
    });

    // 切回 A：接的是 A 桶的历史，B 的发言不串场（v2 签名错绑的回归点）。
    await page.getByRole("button", { name: "切换策略" }).click();
    await page.getByRole("menuitem", { name: /^桶隔离A/ }).click();
    await expect(page.getByText("A 的第一句")).toBeVisible();
    await expect(page.getByText("B 的第一句")).not.toBeVisible();

    // 新建策略聊一句 → 草稿桶会话；切回 A 时它不错绑到 A。
    await page.getByRole("button", { name: "切换策略" }).click();
    await page.getByRole("button", { name: "新建策略" }).click();
    await page.getByLabel("打标指令").fill("草稿桶的一句话");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByText("E2E 假模型的打标结果").last()).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "切换策略" }).click();
    await page.getByRole("menuitem", { name: /^桶隔离A/ }).click();
    await expect(page.getByText("A 的第一句")).toBeVisible();
    await expect(page.getByText("草稿桶的一句话")).not.toBeVisible();

    // 重启：草稿桶会话在新建态下接续（新建策略点击 = 接续草稿桶）。
    await page.reload();
    await page.getByRole("button", { name: "切换策略" }).click();
    await page.getByRole("button", { name: "新建策略" }).click();
    await expect(page.getByText("草稿桶的一句话")).toBeVisible();
  });

  test("新增策略弹窗开着跨切页不丢：齿轮跳设置、端点列表切回来已重拉", async ({
    page,
    request,
  }, testInfo) => {
    // 稿 #18 格 5 裁甲的体验级依据（jsdom 只验了副作用解除）：打标页由 <Activity> 保活，
    // 齿轮跳该库管理处**不关本窗**，切回来时弹层重开即重拉列表。
    const directory = testInfo.outputPath("materials");
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "sample.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    const registered = await request.post("/api/workdirs", {
      data: { path: directory, title: "跨切页弹窗" },
    });
    expect(registered.status()).toBe(202);
    const accepted = await registered.json();
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/tasks/${accepted.task_id}`)).json())
            .status,
      )
      .toBe("succeeded");

    await page.goto("/");
    await page.getByRole("button", { name: "打标", exact: true }).click();
    await page.getByRole("button", { name: "选择工作目录与批次" }).click();
    await page.getByRole("button", { name: /新增策略 跨切页弹窗/ }).click();
    const dialog = page.getByRole("dialog", { name: "新增策略" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("textbox", { name: "策略名" }).fill("切页不该丢");

    await dialog.getByRole("button", { name: "端点配置" }).click();
    // 弹层内容挂在 body 下的 portal 里（不在 dialog 元素内），齿轮要从全局取。
    await page.getByRole("button", { name: "前往设置 · 端点配置" }).click();

    // 跳页连弹层一起带走、什么都不丢：弹窗节点随保活的打标页被标 display:none（不是被卸载），
    // 切回来它就在原地——这一条正是「保活与切页即卸载的直觉相反」的体验级证据（稿 #18
    // 格 5 裁甲；机制探针在 evidence/Qoder-2026-1009-1437-newstrategy/）。
    // 隐藏期连标题一起 display:none，可及名算不出来（aria-labelledby 指向隐藏节点），
    // 这一段只能用 role 属性选择器量「节点在不在、藏没藏」。
    const dialogNode = page.locator('[role="dialog"]');
    await expect(dialogNode).toBeAttached();
    await expect(dialogNode).toBeHidden();
    await expect(page.getByTestId("page-labeling")).not.toBeVisible();
    const added = await request.post("/api/endpoints", {
      data: {
        name: "跨切页端点",
        base_url: isolatedFakeLlmURL("page-state.spec.ts"),
        model: "relisted",
        api_key: "sk-e2e-not-a-real-key", // pragma: allowlist secret
      },
    });
    expect(added.ok()).toBeTruthy();

    // 设置页的侧栏整条换成设置导航（没有「打标」那枚），回打标走「返回工作区」。
    await page.getByRole("button", { name: "返回工作区" }).click();
    // 切回来什么都不丢：表单值还在、弹层还开着；隐藏期「挂载即取数」的 effect 随保活机制卸载、
    // 切回重建时又拉了一遍，所以新端点不用重开弹窗就进了列表（笔⑦同一机制的跨页那一面）。
    // 这一段按节点／文本取而不按可及名：保活把 dialog 与弹层两层 hideOthers 的存取序打乱了，
    // 切回后两层 portal 上残留 aria-hidden="true"（看得见、点得动，可及性树里没它——挂起清单那笔）。
    await expect(dialogNode.locator("input")).toHaveValue("切页不该丢");
    await expect(
      page.locator('[role="menuitem"]', { hasText: "跨切页端点 · relisted" }),
    ).toBeVisible();
  });
});
