import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { test, type Page } from "@playwright/test";

import { probe, settle } from "./fixtures/baseline-probe";
import { defineBaselineScreens } from "./fixtures/baseline-screens";

// 全档存档（规划档 §4.2 ②）：批0 把全档探针文本冻结进仓，供批2~15 的「只报不卡」
// 比较器逐批比对。与断言式基线（visual-baseline）刻意分开承载：
//   - 快照目录按 spec 文件名天然隔离（snapshotPathTemplate 含 testFileName）——互不撞名；
//   - describe 名含「视觉与请求基线」→ verify-steps slow 步与 ci.yml 的 --grep-invert
//     天然不捡（E1 排除口径）；再加 env-gate 双保险（默认 skip）。
//   - 存档用探针文本直写（不走 toMatchSnapshot）：比较器要按行 key 配对 diff，文本即产物。
//
// 跑法（首采 / 确需换桩数据的批次重采该屏）：
//   cd workspace/e2e && ARCHIVE_CAPTURE=1 npx playwright test _baseline-archive --update-snapshots
//   ——本件不走快照机制，--update-snapshots 只是习惯性兜底（无快照断言，它什么都不改）；
//   重采直接跑同命令覆盖文本。
//
// 存档冻结：批0 定格后只读；某批确需改桩数据（批10 对话流／批8 弹层最可能），该批报告头
// 注明、只替换该屏存档，其余屏不动（规划档 §4.2 ④）。

// 存档永远是全档：无视外部 BASELINE_TIER。
process.env.BASELINE_TIER = "full";

/** 存档落点：e2e/baseline-archive/full/<name>-styles.txt / -requests.txt（入库、冻结）。
 * 文件名用连字符分隔（Playwright 快照机制会把点规范成连字符——两处命名保持一致）。 */
function archivePath(name: string): string {
  const dir = path.resolve(process.cwd(), "baseline-archive/full");
  mkdirSync(dir, { recursive: true });
  return path.join(dir, `${name}.txt`);
}

async function snapArchive(page: Page, sink: string[], name: string): Promise<void> {
  await settle(page, sink);
  writeFileSync(archivePath(`${name}-styles`), (await probe(page)) + "\n", "utf-8");
  writeFileSync(archivePath(`${name}-requests`), sink.join("\n") + "\n", "utf-8");
}

test.describe("视觉与请求基线（全档存档）", () => {
  test.skip(process.env.ARCHIVE_CAPTURE !== "1", "全档存档：ARCHIVE_CAPTURE=1 才跑");
  defineBaselineScreens(test, snapArchive);
});
