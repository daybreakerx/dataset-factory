/**
 * 项目自持 SVG 图标——只装「lucide 包内已无对应形状」的图标，外包属性与 lucide
 * 一致（24×24 栅格、fill none、stroke currentColor 2px 圆角），用法可无缝互换。
 * 形状基准＝稿侧 prototype/assets/icons.js（单一事实源，path 同源抄录）。
 */
import type { ComponentProps } from "react";

/** 锥度垃圾桶（稿 icons.js「i-trash-2」同源 path）：lucide-react 自 v1.45 起
 *  trash／trash-2 收成同一形状（侧壁垂直、无锥度），实现侧不能靠包——
 *  2026-09-30 用户裁「我要有锥度的删除图标」，此为形状基准的自持实现。
 *  默认 aria-hidden（使用点均为带 aria-label／文字的装饰位），实例可显式覆盖。 */
export function TrashIcon(props: ComponentProps<"svg">) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}
