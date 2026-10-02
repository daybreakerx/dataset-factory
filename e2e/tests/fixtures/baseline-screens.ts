import type { APIRequestContext, Page } from "@playwright/test";
import type { TestType } from "@playwright/test";

import {
  boot,
  settle,
  type SnapFn,
} from "./baseline-probe";
import {
  PNG_1PX,
  bootGated,
  gatedOverrides,
  gatedRelease,
  gatedReset,
  seedGatedStrategy,
  waitGateEntered,
} from "./label-stream";

// 基线屏清单的单一来源：visual-baseline（断言式）与 _baseline-archive（全档存档）两份
// spec 都从这里拿同一套屏定义——交互步骤只写一遍，两处采集永不漂移。
//
// 屏分组：
//   01~14  既有 14 屏（原 visual-baseline 内联定义，搬入共享）。
//   15~18  交互态补采：各页弹窗开/弹层开。
//   19~21  对话流内容态：历史消息/未完成章为纯桩；流式中经真后端闸门（label-stream.ts，
//          路由桩一次性 fulfill 桩不出「响应中」瞬态，只有闸门链路可达）。
//   22~27  宽度档：390×844（<768）与 900×900（768–1023），关键页 = 工作台/设置端点/设置
//          技能；钉现状响应式行为——断点升级属后续视觉施工，基线不带。
//
// 首采 / 有意更新基线：npx playwright test visual-baseline --update-snapshots

/** 打开会话历史桩：历史消息组（用户带图附件 + 思考/耗时的助手回复）。 */
const HISTORY_SESSION = {
  session_id: "s-hist",
  strategy_id: "st1",
  settings: { prompt_id: "p-1", skill_ids: [] },
  messages: [
    { role: "user", text: "描述这张图片", attachment: "alpha.png", partial: false },
    {
      role: "assistant",
      text: "画面主体是一张用于视觉基线的测试图。",
      attachment: null,
      partial: false,
      reasoning: "先确认主体，再描述背景与光线。",
      reasoning_ms: 1200,
      elapsed_ms: 3400,
    },
    { role: "user", text: "把主色改成更暖的调子。", attachment: null, partial: false },
    {
      role: "assistant",
      text: "已把主色调整为暖调。",
      attachment: null,
      partial: false,
      reasoning: null,
      reasoning_ms: null,
      elapsed_ms: 2100,
    },
  ],
};

/** 未完成章屏的会话桩：末条 partial（断流半截）。 */
const PARTIAL_SESSION = {
  session_id: "s-partial",
  strategy_id: "st1",
  settings: { prompt_id: "p-1", skill_ids: [] },
  messages: [
    { role: "user", text: "描述这张图片", attachment: null, partial: false },
    {
      role: "assistant",
      text: "画面主体是一张用于视觉基线的测试图，背景为",
      attachment: null,
      partial: true,
      reasoning: "先确认主体……",
      reasoning_ms: 900,
      elapsed_ms: null,
    },
  ],
};

/**
 * 定义全部基线屏。
 *
 * @param test Playwright 的 test 对象（两份 spec 各传入自己的）。
 * @param snap 采集函数：断言式 spec 传快照版，存档 spec 传落盘版。
 */
export function defineBaselineScreens(
  test: TestType<{ page: Page; request: APIRequestContext }, Record<string, never>>,
  snap: SnapFn,
): void {
  /** 进打标页：桩数据里只有一个工作目录与一个批次，页面会自动选中。 */
  async function openLabeling(page: Page): Promise<void> {
    await page.getByRole("button", { name: "打标", exact: true }).click();
    await page.getByRole("region", { name: "批次概览" }).waitFor({ state: "visible" });
  }

  /**
   * 进设置页并等默认子页（端点配置）挂载完，返回 sink 已含端点请求。
   *
   * 宽档适配（钉现状断点行为）：<1024（md）侧栏隐藏、顶条出现——此时「设置」钮在
   * 侧栏抽屉里，须先点顶条「打开导航」再点抽屉内导航项（现状链路，断点升级属
   * 后续视觉施工，基线不带）。
   */
  async function openSettings(page: Page, sink: string[], narrow = false): Promise<void> {
    if (narrow) {
      await page.getByRole("button", { name: "打开导航" }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "设置", exact: true })
        .click();
    } else {
      await page.getByRole("button", { name: "设置", exact: true }).click();
    }
    await settle(page, sink);
  }

  test("01 工作台首屏", async ({ page }) => {
    const sink = await boot(page);
    await page.getByRole("textbox", { name: "策略名称" }).waitFor({ state: "visible" });
    await snap(page, sink, "01-workbench");
  });

  test("02 工作台-提示词下拉", async ({ page }) => {
    const sink = await boot(page);
    await page.getByRole("button", { name: "切换提示词" }).click();
    await snap(page, sink, "02-workbench-prompt-menu");
  });

  test("03 工作台-端点切换器", async ({ page }) => {
    const sink = await boot(page);
    await page.getByRole("button", { name: "端点配置切换器" }).click();
    await snap(page, sink, "03-workbench-endpoint-menu");
  });

  test("04 设置-端点段", async ({ page }) => {
    const sink = await boot(page);
    await openSettings(page, sink);
    await snap(page, sink, "04-settings-endpoint");
  });

  test("05 设置-服务段", async ({ page }) => {
    const sink = await boot(page);
    await openSettings(page, sink);
    await page.getByRole("button", { name: "服务运行", exact: true }).click();
    await snap(page, sink, "05-settings-service");
  });

  test("06 设置-Skill 段", async ({ page }) => {
    const sink = await boot(page);
    await openSettings(page, sink);
    await page.getByRole("button", { name: "技能", exact: true }).click();
    await snap(page, sink, "06-settings-skill");
  });

  test("07 打标概览", async ({ page }) => {
    const sink = await boot(page);
    await openLabeling(page);
    await snap(page, sink, "07-labeling-overview");
  });

  test("08 打标-素材预览", async ({ page }) => {
    const sink = await boot(page);
    await openLabeling(page);
    await page.getByRole("button", { name: "alpha.png", exact: true }).click();
    await snap(page, sink, "08-labeling-preview");
  });

  test("09 打标-暗色概览", async ({ page }) => {
    const sink = await boot(page);
    await openLabeling(page);
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await snap(page, sink, "09-labeling-dark");
  });

  test("10 打标-新建跑批弹窗", async ({ page }) => {
    const sink = await boot(page);
    await openLabeling(page);
    await page.getByRole("button", { name: "新建跑批", exact: true }).click();
    await snap(page, sink, "10-labeling-new-batch");
  });

  test("11 打标-工作目录设置抽屉", async ({ page }) => {
    const sink = await boot(page);
    await openLabeling(page);
    await page.getByRole("button", { name: "选择工作目录与批次" }).click();
    await page.getByRole("button", { name: /工作目录设置/ }).first().click();
    await snap(page, sink, "11-labeling-workdir-settings");
  });

  test("12 打标-策略快照弹窗", async ({ page }) => {
    const sink = await boot(page);
    await openLabeling(page);
    await page.getByRole("button", { name: "快照", exact: true }).click();
    await snap(page, sink, "12-labeling-snapshot");
  });

  // 13 / 14 两屏补的是「单测里删掉的实现细节断言该由谁负责」这一层：折叠态的高度与损坏
  // Skill 的错误色都是纯视觉口径，jsdom 量不到（探针按盒尺寸与计算样式取值，正好量得到）。
  test("13 打标-素材折叠为小图", async ({ page }) => {
    const sink = await boot(page);
    await openLabeling(page);
    await page.getByRole("button", { name: "alpha.png", exact: true }).click();
    await settle(page, sink);
    await page.getByRole("button", { name: "折叠为小图" }).click();
    await snap(page, sink, "13-labeling-tile-folded");
  });

  test("14 设置-Skill 含损坏项", async ({ page }) => {
    const sink = await boot(page, {
      "GET /api/skills": [
        { name: "caption-style", description: "风格约束", enabled: true, body_chars: 1234 },
        {
          name: "broken",
          description:
            "文件损坏：SKILL.md 的 frontmatter 未闭合（开头有 ---，但找不到结束的 ---）。",
          enabled: true,
          body_chars: 0,
        },
      ],
    });
    await openSettings(page, sink);
    await page.getByRole("button", { name: "技能", exact: true }).click();
    await snap(page, sink, "14-settings-skill-corrupt");
  });

  test("15 工作台-策略下拉", async ({ page }) => {
    const sink = await boot(page);
    await page.getByRole("button", { name: "切换策略" }).click();
    await snap(page, sink, "15-workbench-strategy-menu");
  });

  test("16 设置-删除端点配置弹窗", async ({ page }) => {
    const sink = await boot(page);
    await openSettings(page, sink);
    await page.getByRole("button", { name: /offline/ }).click();
    await settle(page, sink);
    await page.getByRole("button", { name: "删除", exact: true }).click();
    await snap(page, sink, "16-settings-endpoint-delete");
  });

  test("17 设置-导入 Skill 弹窗", async ({ page }) => {
    const sink = await boot(page);
    await openSettings(page, sink);
    await page.getByRole("button", { name: "技能", exact: true }).click();
    await settle(page, sink);
    await page.getByRole("button", { name: "导入 Skill" }).click();
    await snap(page, sink, "17-settings-skill-import");
  });

  test("18 设置-删除 Skill 弹窗", async ({ page }) => {
    const sink = await boot(page);
    await openSettings(page, sink);
    await page.getByRole("button", { name: "技能", exact: true }).click();
    await page.getByRole("button", { name: /caption-style/ }).first().click();
    await settle(page, sink);
    await page.getByRole("button", { name: "删除技能" }).click();
    await snap(page, sink, "18-settings-skill-delete");
  });

  test("19 对话-历史消息与附件", async ({ page }) => {
    const sink = await boot(page, { "GET /api/sessions/latest": HISTORY_SESSION });
    await page.getByRole("log", { name: "消息流" }).waitFor({ state: "visible" });
    await snap(page, sink, "19-workbench-session");
  });

  test("20 对话-未完成章", async ({ page }) => {
    const sink = await boot(page, { "GET /api/sessions/latest": PARTIAL_SESSION });
    await page.getByRole("log", { name: "消息流" }).waitFor({ state: "visible" });
    await snap(page, sink, "20-workbench-partial");
  });

  // 流式中（真后端闸门链路）：带素材发送 → gated-e2e-model 进闸 → 界面停在「响应中」
  // → 采集 → 放行收尾。数据根是共用服务自建的临时目录，进程退出即清，无跨轮污染。
  test("21 对话-流式中", async ({ page, request }) => {
    const ids = await seedGatedStrategy(request);
    await gatedReset(request);
    const sink: string[] = [];
    await bootGated(page, sink, gatedOverrides(ids));
    await page.getByRole("textbox", { name: "策略名称" }).waitFor({ state: "visible" });
    // chip 选中真 gated 端点：请求显式携带端点（全局激活退役），不选进不了闸门。
    await page.getByRole("button", { name: "端点配置切换器" }).click();
    await page.getByRole("menu").getByRole("menuitem", { name: /gated-probe/ }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "probe.png",
      mimeType: "image/png",
      buffer: Buffer.from(PNG_1PX, "base64"),
    });
    await page.getByPlaceholder("输入指令，继续交互").fill("描述这张图");
    await page.keyboard.press("Enter");
    await waitGateEntered(request);
    await snap(page, sink, "21-workbench-streaming");
    await gatedRelease(request);
  });

  test("22 窄屏-工作台（390）", async ({ page }) => {
    const sink = await boot(page, {}, { width: 390, height: 844 });
    await page.getByRole("textbox", { name: "策略名称" }).waitFor({ state: "visible" });
    await snap(page, sink, "22-narrow-workbench");
  });

  test("23 窄屏-设置端点（390）", async ({ page }) => {
    const sink = await boot(page, {}, { width: 390, height: 844 });
    await openSettings(page, sink, true);
    await snap(page, sink, "23-narrow-settings-endpoint");
  });

  test("24 窄屏-设置技能（390）", async ({ page }) => {
    const sink = await boot(page, {}, { width: 390, height: 844 });
    await openSettings(page, sink, true);
    // 窄屏下设置页的子页导航同样收在「打开导航」抽屉里（设置模式侧栏变体）。
    await page.getByRole("button", { name: "打开导航" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "技能", exact: true })
      .click();
    await snap(page, sink, "24-narrow-settings-skill");
  });

  test("25 中宽-工作台（900）", async ({ page }) => {
    const sink = await boot(page, {}, { width: 900, height: 900 });
    await page.getByRole("textbox", { name: "策略名称" }).waitFor({ state: "visible" });
    await snap(page, sink, "25-mid-workbench");
  });

  test("26 中宽-设置端点（900）", async ({ page }) => {
    const sink = await boot(page, {}, { width: 900, height: 900 });
    await openSettings(page, sink);
    await snap(page, sink, "26-mid-settings-endpoint");
  });

  test("27 中宽-设置技能（900）", async ({ page }) => {
    const sink = await boot(page, {}, { width: 900, height: 900 });
    await openSettings(page, sink);
    await page.getByRole("button", { name: "技能", exact: true }).click();
    await snap(page, sink, "27-mid-settings-skill");
  });
}
