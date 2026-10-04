/**
 * 连接 · 端点配置 · 删除确认弹窗（DialogShell 预设层接线；删除命令由面板执行）。
 * 两行确认窄档（宽度＝内容宽、上限 480、下限 360，DESIGN.md 四 / 稿侧 base.css
 * §13 `.modal--narrow`）；无正文段——删除的约束说明只留页脚左备注槽一行。
 * 全局激活退役后删除无前置拦截（ADR 2026-09-30），任何配置可直接删。
 * 破坏性钮走红字描边档（稿 btn--danger-text）；飞行期两钮只失效不换装、
 * 关闭钮补随态 Tip；失败就地进弹窗正文槽（不关弹窗，环境类失败走浮层）。
 */
import type { ReactElement } from "react";
import { DialogShell } from "../../../components/dialog-shell";
import { FormError } from "../../../components/form-error";

type DeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 待删除的配置名（标题点名用）。 */
  target: string;
  /** 提交后的飞行期：提交与取消两钮只失效不换装，关闭钮补随态 Tip。 */
  flight?: boolean;
  /** 删除失败的业务错误文案；非空时弹窗保持打开、正文槽新开一行红字。 */
  error?: string;
  onConfirm: () => void;
};

/** 删除端点配置的确认弹窗：确认后由面板调删除接口，取消仅关弹窗。 */
export function DeleteDialog({
  open,
  onOpenChange,
  target,
  flight,
  error,
  onConfirm,
}: DeleteDialogProps): ReactElement {
  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      className="w-fit min-w-[min(360px,calc(100vw-48px))] max-w-[min(480px,calc(100vw-48px))]"
      title={<>删除端点配置「{target}」？</>}
      note="此操作不可撤销"
      flight={flight}
      closeTip={flight ? "关闭不等于撤销删除" : ""}
      cancel={{ label: "取消", onClick: () => onOpenChange(false) }}
      confirm={{
        label: "删除",
        variant: "danger-text",
        onClick: onConfirm,
      }}
    >
      {error !== undefined && error !== "" && (
        <FormError data-dialog-error className="text-t-sm text-bad-ink">
          {error}
        </FormError>
      )}
    </DialogShell>
  );
}
