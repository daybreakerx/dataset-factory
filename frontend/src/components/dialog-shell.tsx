import type { ComponentProps, ReactNode } from "react";

import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

/**
 * 页脚动作钮的形态；variant 缺省时取弹窗族现状多数派（取消钮 outline、确认钮 default）。
 */
export type DialogAction = {
  label: ReactNode;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
  disabled?: boolean;
  onClick: () => void;
};

export type DialogShellProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 标准头行。头行有类名/布局分叉的弹窗不传，由 children 自组以保持现状 DOM。 */
  title?: ReactNode;
  description?: ReactNode;
  /** 页脚左备注槽（现状形态：mr-auto self-center text-t-sm text-text-1）。 */
  note?: ReactNode;
  /** 页脚中段自由位，渲染在备注槽与取消钮之间。 */
  footerExtra?: ReactNode;
  /** 行尾前的取消/关闭钮，缺省不渲染。 */
  cancel?: DialogAction;
  /** 行尾主动作钮，缺省不渲染。 */
  confirm?: DialogAction;
  /** 自由页脚（多钮状态机等）；传入时整行替换 cancel/confirm/note 组合。 */
  footer?: ReactNode;
  /** 透传 DialogContent；宽度、max-h、overflow 等壳面差异由调用方按现状值传入，本层不发明档位。 */
  className?: string;
  children?: ReactNode;
};

/**
 * 应用内弹窗族件——DialogContent 的纯 props 预设层。
 *
 * 渲染与手写 Dialog 结构逐元素相同（零新增 DOM）：标准头行（title/description）、
 * 主体 children、可选页脚（note 备注槽＋cancel/confirm 动作对，或自由 footer）。
 * 头行或页脚有形态分叉的弹窗不传对应 props、由 children 自组，现状结构原样保留；
 * 壳面宽度与滚动经 className 透传。弹窗视觉归一（宽度档、备注槽、飞行期钮态等）
 * 属对齐批施工，届时改这一处全站生效。
 */
export function DialogShell({
  open,
  onOpenChange,
  title,
  description,
  note,
  footerExtra,
  cancel,
  confirm,
  footer,
  className,
  children,
}: DialogShellProps) {
  const hasStandardFooter =
    footer !== undefined ||
    note !== undefined ||
    footerExtra !== undefined ||
    cancel !== undefined ||
    confirm !== undefined;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={className}>
        {title !== undefined && (
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description !== undefined && (
              <DialogDescription>{description}</DialogDescription>
            )}
          </DialogHeader>
        )}
        {children}
        {footer !== undefined ? (
          <DialogFooter>{footer}</DialogFooter>
        ) : hasStandardFooter ? (
          <DialogFooter>
            {note !== undefined && (
              <span className="mr-auto self-center text-t-sm text-text-1">{note}</span>
            )}
            {footerExtra}
            {cancel !== undefined && (
              <Button
                type="button"
                variant={cancel.variant ?? "outline"}
                size={cancel.size}
                disabled={cancel.disabled}
                onClick={cancel.onClick}
              >
                {cancel.label}
              </Button>
            )}
            {confirm !== undefined && (
              <Button
                type="button"
                variant={confirm.variant ?? "default"}
                size={confirm.size}
                disabled={confirm.disabled}
                onClick={confirm.onClick}
              >
                {confirm.label}
              </Button>
            )}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
