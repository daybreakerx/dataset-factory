/**
 * 未保存确认弹窗（两行确认窄档）——「当前有未保存编辑，是否保存。」
 *
 * 规格＝未保存确认弹窗稿（设置页/未保存确认弹窗.html；2026-10-04 用户裁跨页复用）：
 * 无正文段、无备注槽（弹性空隙把按钮组推向右侧）、叉号承担取消语义；三路行为由
 * 调用方实现——保存（成功后继续触发动作）／放弃（回退后继续）／叉号·Esc（留下不动作）；
 * 保存失败＝正文区新开一行红字、弹窗保持打开（环境类走浮层、不进弹窗）；飞行期两钮
 * 只失效不换装、关闭钮照常可点。现役实例：策略页提示词／策略切换、设置页切子页与
 * 两面板的切行／进创建态／预览切换。
 */
import type { ReactElement } from "react";

import { DialogShell } from "./dialog-shell";
import { FormError } from "./form-error";

export function UnsavedConfirmDialog({
  open,
  onOpenChange,
  flight,
  error,
  onSave,
  onDiscard,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 保存请求在飞：两钮只失效不换装（外观与就绪态同形）。 */
  flight?: boolean;
  /** 保存失败的业务错误文案；非空时弹窗保持打开、正文槽新开一行红字。 */
  error?: string;
  onSave: () => void;
  onDiscard: () => void;
}): ReactElement {
  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      className="w-fit min-w-[min(360px,calc(100vw-48px))] max-w-[min(480px,calc(100vw-48px))]"
      title="当前有未保存编辑，是否保存。"
      flight={flight}
      cancel={{ label: "放弃修改", onClick: onDiscard }}
      confirm={{ label: "保存修改", onClick: onSave }}
    >
      {error !== undefined && error !== "" && (
        <FormError data-dialog-error className="text-t-sm text-bad-ink">
          {error}
        </FormError>
      )}
    </DialogShell>
  );
}
