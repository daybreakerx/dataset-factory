import { describe, expect, it } from "vitest";
import { formatBytes, formatBytesAuto, formatChars } from "./format";

/** 收成助手之前各调用点写的原式（照搬过来作对照，不是再实现一遍给人读）。 */
function legacyKB(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}
function legacyMB2(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
function legacyAuto(bytes: number): string {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 ** 2
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

const SAMPLES: number[] = [
  0, 1, 512, 1023, 1024, 1536, 10_747, 60_336, 1_048_575, 1_048_576, 3_145_728,
  104_857_600,
];

describe("字节显示格式化", () => {
  it("KB 一位小数与收成助手前的原式逐字一致", () => {
    for (const bytes of SAMPLES) {
      expect(formatBytes(bytes, "KB", 1)).toBe(legacyKB(bytes));
    }
  });

  it("MB 两位小数与收成助手前的原式逐字一致", () => {
    for (const bytes of SAMPLES) {
      expect(formatBytes(bytes, "MB", 2)).toBe(legacyMB2(bytes));
    }
  });

  it("自动升档在三个量级上的取值与边界", () => {
    for (const bytes of SAMPLES) {
      expect(formatBytesAuto(bytes)).toBe(legacyAuto(bytes));
    }
    expect([
      formatBytesAuto(1023),
      formatBytesAuto(1024),
      formatBytesAuto(1_048_575),
      formatBytesAuto(1_048_576),
    ]).toEqual(["1023 B", "1.0 KB", "1024.0 KB", "1.0 MB"]);
  });

  it("位数与单位都由调用点决定，不在助手内改写", () => {
    expect([
      formatBytes(1_048_576, "KB", 1),
      formatBytes(1_048_576, "MB", 1),
      formatBytes(1_048_576, "MB", 2),
    ]).toEqual(["1024.0 KB", "1.0 MB", "1.00 MB"]);
  });
});
describe("注入字数格式化", () => {
  it("统一 k（千字）一档：一位小数、整数省小数（DESIGN.md 六口径）", () => {
    expect([
      formatChars(0),
      formatChars(820),
      formatChars(999),
      formatChars(1_000),
      formatChars(3_600),
      formatChars(9_999),
      formatChars(10_000),
      formatChars(12_400),
      formatChars(16_000),
    ]).toEqual([
      "0k 字",
      "0.8k 字",
      "1k 字",
      "1k 字",
      "3.6k 字",
      "10k 字",
      "10k 字",
      "12.4k 字",
      "16k 字",
    ]);
  });
});
