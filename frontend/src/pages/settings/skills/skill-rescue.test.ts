/** rescueSkillFrontmatter 的边界用例：12 种坏法里「值在文件里」的形状都要捞得回。 */
import { describe, expect, it } from "vitest";
import { rescueSkillFrontmatter } from "./skill-rescue";

describe("rescueSkillFrontmatter", () => {
  it("未闭合 frontmatter：键值完整时两个键都捞回", () => {
    const text = "---\nname: shot-lighting\ndescription: 夜景布光参考\n没有闭合";

    expect(rescueSkillFrontmatter(text)).toEqual({
      name: "shot-lighting",
      description: "夜景布光参考",
    });
  });

  it("分隔行带尾随空格照常捞回（strip 口径）", () => {
    const text = "--- \nname: spaced\ndescription: d\n---  \n正文";

    expect(rescueSkillFrontmatter(text)).toEqual({
      name: "spaced",
      description: "d",
    });
  });

  it("键前带 Tab / 空白缩进、列表项 `- name:` 形式都认", () => {
    const text = "---\n\tname: indented\n  - description: listed\n---\n正文";

    expect(rescueSkillFrontmatter(text)).toEqual({
      name: "indented",
      description: "listed",
    });
  });

  it("YAML 1.1 标量陷阱形状原样取字符串（yes / 日期）", () => {
    const text = "---\nname: yes\ndescription: 2026-09-30\n没有闭合";

    expect(rescueSkillFrontmatter(text)).toEqual({
      name: "yes",
      description: "2026-09-30",
    });
  });

  it("成对引号包裹的值剥引号", () => {
    const text = "---\nname: \"quoted name\"\ndescription: 'single'\n正文";

    expect(rescueSkillFrontmatter(text)).toEqual({
      name: "quoted name",
      description: "single",
    });
  });

  it("键存在但值没写 → 该键 undefined（值真没写，字段留空待填）", () => {
    const text = "---\nname:\ndescription:   \n没有闭合";

    expect(rescueSkillFrontmatter(text)).toEqual({
      name: undefined,
      description: undefined,
    });
  });

  it("连 frontmatter 都没有（缺起始分隔行）→ 两键皆 undefined", () => {
    expect(rescueSkillFrontmatter("# 只有正文\nname: 不是元数据")).toEqual({
      name: undefined,
      description: undefined,
    });
  });

  it("只扫 frontmatter 区域：正文里的 name: 示例不误捞", () => {
    const text = "---\nname: real\ndescription: real-d\n---\n正文 name: fake";

    expect(rescueSkillFrontmatter(text)).toEqual({
      name: "real",
      description: "real-d",
    });
  });

  it("BOM 与 CRLF 行尾不碍事（Windows 常见形状）", () => {
    const text = "\uFEFF---\r\nname: bom\r\ndescription: crlf\r\n";

    expect(rescueSkillFrontmatter(text)).toEqual({
      name: "bom",
      description: "crlf",
    });
  });
});
