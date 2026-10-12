/**
 * 项目自持 SVG 图标——只装「lucide 包内已无对应形状」的图标，外包属性与 lucide
 * 一致（24×24 栅格、fill none、stroke currentColor 2px 圆角），用法可无缝互换。
 * 形状基准＝稿侧 prototype/assets/icons.js（单一事实源，path 同源抄录）。
 */
import type { ComponentProps } from "react";

/** 全选三态方框族（稿 icons.js「i-square-frame / i-square-minus / i-square-check」同源 path）。
 *  外框 rect 一律 18×18 x=3 y=3 **rx=5**——lucide 的 Square／SquareMinus／SquareCheck 外框 rx=2，
 *  渲染到 16px 圆角≈1.3px 太方（2026-10-07 用户裁「更圆润」），内芯 path 沿用 lucide 原值；
 *  「停止」钮用的是 12×12 小方框（lucide Square x=6 y=6），与本族不同形、勿混用。
 *  三态字色一律 --text-3（原「已全选上品牌主色」两态换色方案作废——换形后每形只说一件事）。
 *  默认 aria-hidden（使用点都带 aria-label），实例可显式覆盖。 */
function SquareBase(props: ComponentProps<"svg">) {
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
    />
  );
}

/** 未全选（空心方框）＝点下去全选。 */
export function SquareFrameIcon(props: ComponentProps<"svg">) {
  return (
    <SquareBase {...props}>
      <rect width="18" height="18" x="3" y="3" rx="5" />
    </SquareBase>
  );
}

/** 停止／取消方块（稿「i-square」＝18×18／rx 5 同源，lucide SquareIcon 的 rx 2 不合）：
 *  「取消导出」那枚实底钮的前置图标，与全选三态同基座但语义不同，故单列一名。 */
export function SquareStopIcon(props: ComponentProps<"svg">) {
  return (
    <SquareBase {...props}>
      <rect width="18" height="18" x="3" y="3" rx="5" />
    </SquareBase>
  );
}

/** 半选（方框＋横杠）＝点下去补齐全选。 */
export function SquareMinusIcon(props: ComponentProps<"svg">) {
  return (
    <SquareBase {...props}>
      <rect width="18" height="18" x="3" y="3" rx="5" />
      <path d="M8 12h8" />
    </SquareBase>
  );
}

/** 已全选（方框＋对勾）＝点下去清除选择。 */
export function SquareCheckIcon(props: ComponentProps<"svg">) {
  return (
    <SquareBase {...props}>
      <rect width="18" height="18" x="3" y="3" rx="5" />
      <path d="m16 9-5.5 5.5L8 12" />
    </SquareBase>
  );
}

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
