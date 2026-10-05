/**
 * SKILL.md 原文的抢救启发式（字段即修复的前端半边，稿 技能详情头「损坏态 · 可修复」）：
 * frontmatter 解析失败时按正则从原文把 name / description 捞回来预填详情字段。
 * 捞回是启发式不是解析——只认「行内键: 值」形状，允许前导空白、列表项 `- name:` 与
 * 成对引号包裹；值真没写（键缺失或键后空值）→ 该键 undefined，字段留空待填
 * （名字是必须人起的语义值，不以目录名 / ID 顶包——2026-10-01 用户裁）。
 */

/** 抢救结果：键捞到＝字符串值；值真没写＝undefined（区别于空串）。 */
export type RescuedFrontmatter = {
  name: string | undefined;
  description: string | undefined;
};

const NAME_LINE = /^\s*-?\s*name\s*:\s*(.*?)\s*$/;
const DESCRIPTION_LINE = /^\s*-?\s*description\s*:\s*(.*?)\s*$/;

/** 取区域里第一条命中的键值；剥成对引号，键后空值视为「没写」返回 undefined。 */
function extract(lines: string[], pattern: RegExp): string | undefined {
  for (const line of lines) {
    const matched = pattern.exec(line);
    if (matched === null) continue;
    const raw = matched[1] ?? "";
    const value = raw.replace(/^["'](.*)["']$/, "$1").trim();
    return value === "" ? undefined : value;
  }
  return undefined;
}

/**
 * 从 SKILL.md 原文抢救 name / description。
 *
 * @param text 磁盘原文（UTF-8 文本；非 UTF-8 档根本读不出文本、不会走到这里）。
 * @returns 抢救出的字段；没有 frontmatter 起始分隔行（值从未写进过元数据区）→ 两键皆 undefined。
 */
export function rescueSkillFrontmatter(text: string): RescuedFrontmatter {
  const normalized = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const open = lines.findIndex((line) => line.trim() === "---");
  if (open === -1) {
    // 连 frontmatter 都没有：name / description 从未写过，没东西可捞。
    return { name: undefined, description: undefined };
  }
  const closeOffset = lines.slice(open + 1).findIndex((line) => line.trim() === "---");
  // 未闭合 → 闭合行之后不存在，整个剩余部分都是用户想写的元数据区，扫到文件尾。
  const region =
    closeOffset === -1
      ? lines.slice(open + 1)
      : lines.slice(open + 1, open + 1 + closeOffset);
  return {
    name: extract(region, NAME_LINE),
    description: extract(region, DESCRIPTION_LINE),
  };
}
