import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ComponentProps, ReactElement, ReactNode } from "react";

import { cn } from "../../lib/utils";

function TooltipProvider({
  delayDuration = 320,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />;
}

const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

function TooltipContent({
  className,
  // 间距 8（触发件与气泡之间，overlay.md tip 段，2026-10-02 用户裁「贴合取 8」）。
  sideOffset = 8,
  children,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          // 影取浮层族档 --sh-3（与 cfg-pop／modal 同值，不用 Tailwind 默认 shadow-md）；
          // select-none＝气泡是纯展示层，文字不可选（overlay.md tip 段行为④）。
          // wrap-anywhere（overflow-wrap:anywhere）＝稿「上限 320 超上限折行不截断」的落实：
          // 64 位哈希这类不可断长串在 w-fit 盒里若不设断词，其 min-content 会撑破上限、文字溢出盒外；
          // anywhere 让超长词在盒内折行、盒宽回到 ≤320（普通短文案无影响）。
          "z-50 w-fit max-w-[320px] wrap-anywhere rounded-md border bg-popover px-3 py-2 text-t-sm text-popover-foreground shadow-(--sh-3) select-none",
          "data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95",
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

/** 禁用控件收不到指针事件（项目的禁用态 CSS 带 pointer-events: none），气泡直接挂在
 * 它身上永远不弹——触发器必须包在外层中性 span 上（对齐批「禁用控件上的 tip」条）。
 * 原生元素与本项目 Button 的 disabled 都写在 props 上，按 props 正判即可覆盖全部现役禁用场景。 */
function isDisabledChild(child: ReactElement): boolean {
  return (child.props as { disabled?: boolean }).disabled === true;
}

/** 悬停气泡提示（全站提示形态规范）：替代原生 title，避免系统直角灰框。
 * 自带 Provider：页面会被单独渲染（组件测试 / 弹窗复用），不能依赖外壳的 Provider。
 * label 为空串 / null 时直接返回 children——禁用原因这类动态 label 在「可点」态
 * 不该残留一只空气泡（「原型有气泡、实现什么都没有」的反向兜底）。
 * 子元素带 disabled 时先包一层中性 span 当触发器（禁用控件收不到指针事件，见上）。 */
function Tip({ label, children }: { label: ReactNode; children: ReactElement }) {
  if (label === "" || label === null || label === undefined) {
    return children;
  }
  return (
    <TooltipProvider delayDuration={320}>
      <Tooltip>
        {isDisabledChild(children) ? (
          <TooltipTrigger asChild>
            <span className="inline-flex">{children}</span>
          </TooltipTrigger>
        ) : (
          <TooltipTrigger asChild>{children}</TooltipTrigger>
        )}
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export { Tip, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
