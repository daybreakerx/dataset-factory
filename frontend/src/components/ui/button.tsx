import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "../../lib/utils";

const buttonVariants = cva(
  // 微交互（design.md 2.6）：按压 translateY(1px)——位移方向恒定恒向下（原 scale(.98)
  // 在 30px 小钮上低于感知阈、已实测否决）；transform 并入过渡（原 transition-colors 不含）。
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-t-md font-medium transition-[color,background-color,border-color,text-decoration-color,fill,stroke,transform,box-shadow] duration-(--dur-1) active:translate-y-px disabled:pointer-events-none disabled:bg-muted disabled:text-n-400 [&_svg]:pointer-events-none [&_svg]:size-(--icon-md) [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          // 禁用档补 hairline 边（稿 base.css §7「.btn:disabled 只换灰底」+ 重建弹窗条⑪）：
          // 灰底与卡片同色时无边就看不出这里有个钮。
          "bg-primary text-primary-foreground border-input hover:bg-primary-hover active:bg-primary-press disabled:border",
        // 危险图标钮档（base.css §7「危险图标钮」＝.btn--ghost.btn--icon.danger 同款）：
        // 红是状态色、不常驻——静止中性 --text-3、悬停才显红（--bad-ink 字＋--bad-ink/.12 墨底）。
        // 2026-10-12 按 §7 注归一：原「红字常驻＋--bad-bg 实浅底」两点差异消除；
        // 现役调用点均已走 .danger 类挂法（material-row／workdir-batches／config-form／skill-detail／WorkdirSettings），
        // 本变体只剩 story 演示，归一后演示形态与规范档一致。
        destructive:
          "bg-transparent text-text-3 hover:bg-bad-ink/12 hover:text-bad-ink",
        "destructive-fill": "bg-bad-ink text-on-ink hover:bg-bad-ink-strong",
        // 红字描边钮（稿 base.css §7 .btn--danger-text）：确认弹窗里的破坏性动作——
        // 静止态轮廓与取消钮同档（--input），红只作语义信号不铺面积。
        "danger-text":
          "border border-input bg-card text-bad-ink hover:border-n-400 hover:bg-bad-ink/6 active:bg-bad-ink/12",
        "destructive-soft": "bg-bad-ink-soft text-on-ink hover:bg-bad-ink-strong",
        outline:
          "border border-input bg-card hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "text-text-3 hover:bg-accent hover:text-text-1",
        link: "text-text-3 underline underline-offset-4 hover:text-text-1",
        accent:
          "bg-primary/10 text-primary hover:bg-primary/15 dark:bg-primary/26 dark:hover:bg-primary/34",
      },
      size: {
        default: "h-(--h-md) px-3",
        xs: "h-(--h-xs) rounded-full px-3 text-t-xs",
        sm: "h-(--h-sm) px-2 text-t-sm",
        // 图标档随尺寸升一档（base.css §7 `.btn--lg .ic`＝--icon-lg 18px，非基类的 16）：
        // 头行「返回主页面」这类 lg 文字钮按稿取 18。
        lg: "h-(--h-lg) px-4 text-t-lg [&_svg]:size-(--icon-lg)",
        mini: "h-4 rounded-none bg-transparent px-0 text-t-sm text-text-3 hover:bg-transparent hover:text-text-1 disabled:bg-transparent [&_svg]:size-(--icon-sm)",
        icon: "btn-icon size-(--h-md) gap-0 p-0",
        "icon-sm": "btn-icon size-(--h-sm) gap-0 p-0 [&_svg]:size-(--icon-md)",
        "icon-lg": "btn-icon size-(--h-lg) gap-0 p-0 [&_svg]:size-(--icon-lg)",
        // icon-xs（22px 盒）低于触控目标 24×24（design.md 七·7）：透明伪元素把命中区
        // 外扩 1px（base.css §7 .btn--icon.btn--xs::before 同款）——纯热区、视觉零变，
        // 全档使用点一起受益。热区挂 ::after，
        // ::before 让给图标钮的基线零宽空格（见 globals.css 的 .btn-icon）。
        "icon-xs":
          "btn-icon relative size-(--h-xs) gap-0 rounded-md p-0 after:absolute after:-inset-px after:content-[''] [&_svg]:size-(--icon-xs)",
      },
    },
    compoundVariants: [
      {
        // 无底族的禁用档（base.css §18；2026-10-02 用户裁 B「不要加实底」、2026-10-06 扩到
        // ghost 文字钮）：分类轴＝**常态有没有实底**——永远无底的 ghost 文字钮与图标钮一族
        // 没有「换灰底」这件手段，禁用只压字色、底保持透明；有底钮（primary／danger 等）
        // 照常走 base 的 disabled:bg-muted。twMerge 保后者：compound 排在 base 之后，同组覆盖。
        variant: "ghost",
        className: "disabled:bg-transparent",
      },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return (
    <button
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
