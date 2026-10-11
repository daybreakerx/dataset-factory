/** 界面显示用的数值换算（渲染前最后一道格式化，不参与任何计算）。 */

/**
 * 字节数 → 带单位显示串（如 `1.5 KB`、`2.00 MB`）。
 *
 * 单位和位数由调用点指定并原样保留：各屏既有约定不同（清单条目按 KB 一位小数、
 * 体积合计按 MB 两位小数），把它们统一成一种会改到已验收的显示值。舍入沿用
 * `toFixed`，与收成助手之前的写法逐字一致。
 *
 * 单位名按 2026-10-07 用户裁改为 KB / MB，进率不动、仍按 1024 折算——改的是显示口径，不是数值。
 */
export function formatBytes(bytes: number, unit: "KB" | "MB", digits: number): string {
  const divisor = unit === "KB" ? 1024 : 1024 ** 2;
  return `${(bytes / divisor).toFixed(digits)} ${unit}`;
}

/** 自动升档：< 1 KB 给整数 B，< 1 MB 给 KB 一位小数，再往上给 MB 一位小数。 */
export function formatBytesAuto(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 ** 2) {
    return formatBytes(bytes, "KB", 1);
  }
  return formatBytes(bytes, "MB", 1);
}

/**
 * 注入正文字符数 → 字数文案（技能列表、策略库下拉、提示词库下拉共用一份口径）。
 *
 * 统一折算成 **k（千字）一档**：一位小数、整数省去小数（如 16k 字、3k 字、0.9k 字）；
 * 一律不加「约」——字数本身是精确算出来的。口径只有一份（DESIGN.md 六），
 * 原型与实现两边都不另写一套。
 */
export function formatChars(count: number): string {
  const rounded = Math.round((count / 1000) * 10) / 10;
  const text = Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
  return `${text}k 字`;
}

/**
 * 毫秒时长 → 人读时长（V4，2026-09-21 审计定案）：人读时长靠「几分几秒」，不靠小数秒。
 *
 * 三档口径：1 分钟内 `12.4 秒`（保留一位小数——短时长里半秒之差有感）；1 小时内
 * `34 分 39 秒`；超过 1 小时 `1 小时 12 分`（分钟以下不再展示）。
 */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)} 秒`;
  }
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours >= 1) {
    return `${hours} 小时 ${minutes} 分`;
  }
  return rest === 0 ? `${minutes} 分` : `${minutes} 分 ${rest} 秒`;
}

/**
 * 视频时长秒数 → 时长角标串（`0:08` 形态，分:秒、秒两位补零）。
 *
 * 待发附件卡与已发消息的视频缩略图共用同一份口径；时长拿不到（undefined 或
 * 非有限数）时返回 null，调用方据此不渲染角标。
 */
export function durationBadge(seconds: number | undefined): string | null {
  if (seconds === undefined || !Number.isFinite(seconds)) return null;
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}
