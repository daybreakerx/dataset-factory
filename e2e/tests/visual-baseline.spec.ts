import { test } from "@playwright/test";

import { snap } from "./fixtures/baseline-probe";
import { defineBaselineScreens } from "./fixtures/baseline-screens";

// 视觉与请求基线（重构线 L4 层的硬门）。
//
// 为什么要这一件：重构的红线是「不影响现有功能和页面」，而「页面没变」不能靠肉眼看截图。
// 这里对每一屏取两样东西存成快照：
//   1. 计算样式探针——所有可见元素的「行 key + 属性 + 归一化文字 + 关键计算样式 + 盒尺寸」；
//   2. 该屏实际发出的 API 请求清单（方法 + 路径）——重复请求、漏请求都会在这里显形。
// 任何一项变了，快照就红，并直接指出是哪一屏的哪个元素。截图另外落到 .verify/shots/ 供人工
// 目检（PNG 与字体渲染相关，不入仓、不做跨平台比对）。
//
// 数据面全靠路由打桩（不打真后端）：固定输入才有固定输出，时间戳与主键不会出现第二份来源。
// 唯一例外是「21 对话-流式中」：SSE 一次性桩不出「响应中」瞬态，放行到真后端经闸门挂住
// （见 fixtures/label-stream.ts）。探针里的数字统一折成 #，所以「3 项」这类计数变化不会
// 把快照打成假红。
//
// 屏定义在 fixtures/baseline-screens.ts（与 _baseline-archive 共享，单一来源）。
// 采集档位：BASELINE_TIER=full（默认，全档）/ render（渲染等价档）——切档见规划档 §4.2。
// 只报不卡（dump 不断言）：BASELINE_REPORT=1 npx playwright test tests/visual-baseline.spec.ts
//
// 首采 / 有意更新基线：npx playwright test visual-baseline --update-snapshots

test.describe("视觉与请求基线", () => {
  defineBaselineScreens(test, snap);
});
