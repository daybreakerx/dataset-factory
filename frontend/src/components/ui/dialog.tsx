import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "../../lib/utils";
import { Tip } from "./tooltip";

const Dialog = DialogPrimitive.Root;

function DialogOverlay({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/32 dark:bg-black/55 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  closeClassName,
  closeTip,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  /** 关闭叉钮的附加类：实例级覆盖（如窄屏侧栏抽屉实例的定位补正；悬停底统一 --accent 半透明墨）。 */
  closeClassName?: string;
  /** 关闭叉钮的随态 Tip（破坏性弹窗飞行期「关闭不等于撤销删除」）；空串不渲染气泡。 */
  closeTip?: ReactNode;
}) {
  const closeButton = (
    <DialogPrimitive.Close
      className={cn(
        "absolute top-4 right-6 flex size-(--h-md) items-center justify-center rounded-md text-text-3 transition-colors hover:bg-accent hover:text-text-1",
        closeClassName,
      )}
    >
      <XIcon className="size-(--icon-md)" />
      <span className="sr-only">关闭</span>
    </DialogPrimitive.Close>
  );
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          // 宽度＝有正文段弹窗的默认档 480（稿 base.css §13 .modal）；视口两侧留 24。
          // 逐窗登记档（560 导入档等）由实例 className 覆盖；弹窗族归一见 design.md 四。
          // grid-cols-1＝把单列网格轨道的下限从 min-content 抬到 0（minmax(0,1fr)）：
          // 否则轨被内容里最长的 nowrap 行（如快照页脚 64 位哈希）按 min-content 顶破、
          // 内容溢出盒子右缘（盒子宽仍由上面的 w-[...] 定）。收缩交给子项自己的 min-w-0＋省略号。
          "group/dialog fixed top-1/2 left-1/2 z-50 grid grid-cols-1 w-[min(var(--w-modal-480),calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border bg-card py-4 px-6 shadow-(--sh-3)",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      >
        {children}
        {closeTip ? <Tip label={closeTip}>{closeButton}</Tip> : closeButton}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      // pr 42＝关闭叉钮（30px，距缘 24）＋12 间隙：长标题在叉钮前止步，不压钮。
      className={cn("flex flex-col gap-2 pr-[42px] text-left", className)}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        // 页脚形态（稿 base.css §13 .modal-foot）：按钮组靠右、间距 s-3、上 16（格距）＋
        // 内距 12；hairline 分隔线只在「有正文段（DialogDescription）或失败行
        // （data-dialog-error）」时画——标题＋页脚两行的确认弹窗不画（2026-10-01 用户裁）。
        "group-has-[[data-slot=dialog-description]]:border-t group-has-[data-dialog-error]:border-t flex flex-col-reverse gap-3 pt-3 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

function DialogTitle({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      // 行高随稿 .modal-title 取 --lh-base（16px × 1.55 ≈ 24.8 盒高）——全站 t-xl 的
      // lh-tight 映射在弹窗标题这里被稿显式覆盖；标题行的 30px 居中在 DialogShell 组合。
      className={cn("text-t-xl font-medium leading-(--lh-base)", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-t-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
};
