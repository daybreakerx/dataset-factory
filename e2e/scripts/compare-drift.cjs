// 漂移比较器：把当批「全档 dump」（.verify/baseline-dump/）
// 与冻结的全档存档（baseline-archive/full/）逐屏 diff，按两级判读产出批次报告。
//
// 用法：
//   前一步（同批）：BASELINE_REPORT=1 npx playwright test tests/visual-baseline.spec.ts
//   本步：node scripts/compare-drift.cjs --batch 03
//
// 判读规则（用于**读**差异——本件不卡门禁，exit 恒 0）：
//   「key 同而列变」或「行整条消失」= 回归（当批查明修正，不攒账）；
//   「key 变而其余列全同」= 结构性已知差异（可解释即可，如组件拆分/包装层插入）。
//   列比对 = 去掉首列 key 后的整行文本全等。
//
// 报告落 e2e/drift-reports/batch-<NN>.txt（入库）；收口复核以报告目录为逐条归因台账。

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const E2E_ROOT = path.resolve(__dirname, "..");
const ARCHIVE = path.join(E2E_ROOT, "baseline-archive", "full");
const DUMP = path.join(E2E_ROOT, ".verify", "baseline-dump");
const REPORTS = path.join(E2E_ROOT, "drift-reports");

/** 解析参数：--batch NN（报告编号，必填）。 */
function parseArgs(argv) {
  const args = { batch: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--batch") {
      args.batch = argv[i + 1];
      i += 1;
    }
  }
  if (args.batch === null) {
    console.error("用法：node scripts/compare-drift.cjs --batch <NN>");
    process.exit(2);
  }
  return args;
}

/** 读探针文本 → 行数组（key → 原始行）。 */
function readRows(file) {
  if (!fs.existsSync(file)) {
    return null;
  }
  const rows = new Map();
  for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    const key = line.includes(" | ") ? line.split(" | ")[0] : line;
    rows.set(key, line);
  }
  return rows;
}

/** 比较单屏：返回 { regressions, structural, added, missing, total }（条目=描述文本）。 */
function compareScreen(name, archiveRows, dumpRows) {
  const result = { regressions: [], structural: [], added: [], missing: [], total: 0 };
  if (archiveRows === null || dumpRows === null) {
    result.missing.push(
      archiveRows === null ? `存档缺屏：${name}` : `当批 dump 缺屏：${name}`,
    );
    return result;
  }
  // 当批行按「key 变了但其余列全同」找结构对应：其余列文本作索引，在存档行里找同款。
  const archiveByRest = new Map();
  for (const [key, line] of archiveRows) {
    const rest = line.slice(key.length);
    if (!archiveByRest.has(rest)) {
      archiveByRest.set(rest, []);
    }
    archiveByRest.get(rest).push(key);
  }
  const matchedArchiveKeys = new Set();
  for (const [key, line] of dumpRows) {
    const rest = line.slice(key.length);
    if (archiveRows.has(key)) {
      matchedArchiveKeys.add(key);
      const archiveLine = archiveRows.get(key);
      if (archiveLine !== line) {
        result.total += 1;
        result.regressions.push(`[key 同列变] ${name} :: ${key}\n    存档: ${archiveLine}\n    当批: ${line}`);
      }
    } else if (archiveByRest.has(rest) && archiveByRest.get(rest).length > 0) {
      // key 变、其余列全同 → 结构性（配对消耗一个同款存档 key）。
      const oldKey = archiveByRest.get(rest).shift();
      matchedArchiveKeys.add(oldKey);
      result.total += 1;
      result.structural.push(`[key 变列同] ${name} :: ${oldKey} → ${key}`);
    } else {
      result.total += 1;
      result.added.push(`[新增行] ${name} :: ${line}`);
    }
  }
  for (const key of archiveRows.keys()) {
    if (!matchedArchiveKeys.has(key)) {
      result.total += 1;
      result.missing.push(`[行消失] ${name} :: ${archiveRows.get(key)}`);
    }
  }
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const screens = new Set();
  for (const dir of [ARCHIVE, DUMP]) {
    if (fs.existsSync(dir)) {
      for (const file of fs.readdirSync(dir)) {
        if (file.endsWith("-styles.txt")) {
          screens.add(file.replace(/-styles\.txt$/, ""));
        }
      }
    }
  }
  if (screens.size === 0) {
    console.error("没有找到可比较的屏（先跑 BASELINE_REPORT=1 采集，并确认存档在位）");
    process.exit(2);
  }

  const lines = [
    `# 批次漂移报告 batch-${args.batch}`,
    `- 生成时间：${new Date().toISOString()}`,
    `- 口径：全档 dump（.verify/baseline-dump/）vs 冻结全档存档（baseline-archive/full/）`,
    `- 判读：key 同列变 / 行消失 = 回归（当批查明）；key 变列同 = 结构性（可解释即可）`,
    "",
  ];
  let regressionTotal = 0;
  let structuralTotal = 0;
  let screenCount = 0;
  const sorted = Array.from(screens).sort();
  for (const screen of sorted) {
    const result = compareScreen(
      screen,
      readRows(path.join(ARCHIVE, `${screen}-styles.txt`)),
      readRows(path.join(DUMP, `${screen}-styles.txt`)),
    );
    // 请求清单：逐行集合差（顺序敏感——同一屏的请求次序也应稳定）。
    const archiveReq = fs.existsSync(path.join(ARCHIVE, `${screen}-requests.txt`))
      ? fs.readFileSync(path.join(ARCHIVE, `${screen}-requests.txt`), "utf-8").split("\n").filter((l) => l.trim() !== "")
      : null;
    const dumpReq = fs.existsSync(path.join(DUMP, `${screen}-requests.txt`))
      ? fs.readFileSync(path.join(DUMP, `${screen}-requests.txt`), "utf-8").split("\n").filter((l) => l.trim() !== "")
      : null;
    const reqDiff = [];
    if (archiveReq !== null && dumpReq !== null) {
      if (archiveReq.join("\n") !== dumpReq.join("\n")) {
        reqDiff.push("  请求清单有差异（存档 → 当批）：");
        const longer = Math.max(archiveReq.length, dumpReq.length);
        for (let i = 0; i < longer; i += 1) {
          const a = archiveReq[i] ?? "（无）";
          const d = dumpReq[i] ?? "（无）";
          if (a !== d) {
            reqDiff.push(`    #${i + 1} ${a} → ${d}`);
          }
        }
        result.total += reqDiff.length;
        result.regressions.push(`[请求清单] ${screen}\n${reqDiff.join("\n")}`);
      }
    }
    screenCount += 1;
    regressionTotal += result.regressions.length;
    structuralTotal += result.structural.length;
    lines.push(`## ${screen}（差异 ${result.total} 条）`);
    for (const entry of result.regressions) {
      lines.push(`- ⚠ 回归：${entry}`);
    }
    for (const entry of result.structural) {
      lines.push(`- ○ 结构性：${entry}`);
    }
    for (const entry of result.added) {
      lines.push(`- ＋ 新增：${entry}`);
    }
    for (const entry of result.missing) {
      lines.push(`- − 消失/缺屏：${entry}`);
    }
    if (result.total === 0) {
      lines.push("- （零差异）");
    }
    lines.push("");
  }
  lines.push(`## 汇总：${screenCount} 屏，回归 ${regressionTotal} 条，结构性 ${structuralTotal} 条`);
  lines.push("- 回归条目当批归因：预期内注明，不可解释的查明修正，不攒账。");

  fs.mkdirSync(REPORTS, { recursive: true });
  const reportPath = path.join(REPORTS, `batch-${args.batch}.txt`);
  fs.writeFileSync(reportPath, lines.join("\n") + "\n", "utf-8");
  console.log(`报告已落盘：drift-reports/batch-${args.batch}.txt（${screenCount} 屏，回归 ${regressionTotal}，结构性 ${structuralTotal}）`);
  // 只报不卡：恒 0 退出，门禁卡不卡由当批人工判读报告决定。
  process.exitCode = 0;
}

main();
