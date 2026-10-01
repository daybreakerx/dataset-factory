/** 能力 · 技能 · 删除确认弹窗（DialogShell 预设层接线；删除命令由面板执行）。 */
import type { ReactElement } from "react";
import { DialogShell } from "../../../components/dialog-shell";

type DeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 待删除的技能名（标题点名用）。 */
  target: string;
  onConfirm: () => void;
};

/** 删除技能的确认弹窗：确认后由面板调删除接口，取消仅关弹窗。 */
export function DeleteDialog({
  open,
  onOpenChange,
  target,
  onConfirm,
}: DeleteDialogProps): ReactElement {
  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={<>删除技能「{target}」？</>}
      description="将从 Skill 库整目录移除该包。此操作不可撤销；停用 ≠ 删除。"
      cancel={{ label: "取消", onClick: () => onOpenChange(false) }}
      confirm={{
        label: "删除",
        variant: "destructive-fill",
        onClick: onConfirm,
      }}
    />
  );
}
