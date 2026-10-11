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
  /** 覆盖壳级 flight（实例稿口径分叉时用：关机弹窗飞行期只锁确认钮、取消照常可点）。 */
  flight?: boolean;
  onClick: () => void;
};

export type DialogShellProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 标准头行。头行有类名/布局分叉的弹窗不传，由 children 自组以保持现状 DOM。 */
  title?: ReactNode;
  description?: ReactNode;
  /** 失败行落标题右侧（稿 .modal-head-note，正文是表单字段的弹窗用；单行省略＋即时播报）。 */
  headNote?: ReactNode;
  /** 标题右侧常驻红字短警示（稿 .modal-hardwarn：破坏性弹窗一句话讲清动作后果，恒在、不随状态出现）。 */
  hardWarn?: ReactNode;
  /** 页脚左备注槽（稿 .modal-note：mr-auto、13px 正文色，如「此操作不可撤销」）。 */
  note?: ReactNode;
  /** 页脚中段自由位，渲染在备注槽与取消钮之间。 */
  footerExtra?: ReactNode;
  /** 行尾前的取消/关闭钮，缺省不渲染。 */
  cancel?: DialogAction;
  /** 行尾主动作钮，缺省不渲染。 */
  confirm?: DialogAction;
  /** 自由页脚（多钮状态机等）；传入时整行替换 cancel/confirm/note 组合。 */
  footer?: ReactNode;
  /**
   * 飞行期（提交已发出、回包前）：提交与取消两钮一并「只失效不换装」——
   * aria-disabled ＋掐掉点击（外观与就绪态同形，不进灰阶）；Esc 与关闭钮照常可退出。
   */
  flight?: boolean;
  /** 关闭叉钮的随态 Tip（破坏性弹窗飞行期「关闭不等于撤销删除」，未提交传空不出气泡）。 */
  closeTip?: ReactNode;
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
 * 壳面宽度与滚动经 className 透传。
 *
 * 壳级口径（components/overlay.md 弹窗条）：点内容之外（含点遮罩）不关闭——
 * 在本层拦掉 Radix 的 onInteractOutside，一处改全族生效；窄屏侧栏抽屉不走本件
 * （App.tsx 直接用 Dialog），其「点遮罩关闭」保持现状。
 */
export function DialogShell({
  open,
  onOpenChange,
  title,
  description,
  headNote,
  hardWarn,
  note,
  footerExtra,
  cancel,
  confirm,
  footer,
  flight,
  closeTip,
  className,
  children,
}: DialogShellProps) {
  const hasStandardFooter =
    footer !== undefined ||
    note !== undefined ||
    footerExtra !== undefined ||
    cancel !== undefined ||
    confirm !== undefined;
  // 飞行期「只失效不换装」在下方两枚 Button 上落实：不挂 disabled（那条会换灰阶），
  // 挂 aria-disabled ＋掐掉 onClick（键盘 Enter 路径一并拦），外观同形；
  // 实例可用 action.flight 覆盖壳级（关机弹窗飞行期只锁确认钮——稿 底部钮组）。
  const inFlight = (action: DialogAction): boolean => action.flight ?? flight ?? false;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={className}
        closeTip={closeTip}
        onInteractOutside={(event) => event.preventDefault()}
      >
        {title !== undefined && (
          <DialogHeader>
            {/* 标题行随稿 .modal-head：min-h 30（--h-md，关闭钮同高）内垂直居中——
                标题与右上角 × 钮中轴对齐、正文起点与稿逐像素同（描述顶 = 16+30+8）。 */}
            <div className="flex min-h-(--h-md) items-center gap-3">
              <DialogTitle>{title}</DialogTitle>
              {hardWarn !== undefined && (
                <span className="text-t-sm text-bad-ink">{hardWarn}</span>
              )}
              {headNote !== undefined && (
                <span
                  role="alert"
                  className="min-w-0 flex-1 truncate text-t-sm text-bad-ink"
                >
                  {headNote}
                </span>
              )}
            </div>
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
              <span className="mr-auto self-center text-t-md text-text-1">{note}</span>
            )}
            {footerExtra}
            {cancel !== undefined && (
              <Button
                type="button"
                variant={cancel.variant ?? "outline"}
                size={cancel.size}
                disabled={inFlight(cancel) ? undefined : cancel.disabled}
                aria-disabled={inFlight(cancel) || undefined}
                className={inFlight(cancel) ? "pointer-events-none" : undefined}
                onClick={inFlight(cancel) ? undefined : cancel.onClick}
              >
                {cancel.label}
              </Button>
            )}
            {confirm !== undefined && (
              <Button
                type="button"
                variant={confirm.variant ?? "default"}
                size={confirm.size}
                disabled={inFlight(confirm) ? undefined : confirm.disabled}
                aria-disabled={inFlight(confirm) || undefined}
                className={inFlight(confirm) ? "pointer-events-none" : undefined}
                onClick={inFlight(confirm) ? undefined : confirm.onClick}
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
