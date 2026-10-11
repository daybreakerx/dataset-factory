import { useEffect, useRef, useState } from "react";
import { api } from "../../../api";
import { DialogShell } from "../../../components/dialog-shell";
import { FormError } from "../../../components/form-error";
import { Tip } from "../../../components/ui/tooltip";
import { reportError } from "../../../lib/feedback";
import { toast } from "../../../lib/toast";

/**
 * 条目行「删除未导入」确认窗（破坏性确认族形：标题带对象名、无副题、页脚「取消＋删除」）。
 *
 * 2026-10-11 用户裁「此文件将从本地永久删除」：后端不再移进可恢复暂存区，原来的
 * 「结果态·恢复路径回显」整块退役，成功去向＝关窗＋浮层汇报；飞行期关窗与 Esc 照常可退
 * （退出 ≠ 撤销，壳级规则），两个钮只失效不换装、不换词。
 */
export function RemoveUnimportedDialog({
  wid,
  name,
  onClose,
  onRemoved,
}: {
  wid: string;
  name: string;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(true);
  const submitting = useRef(false);
  useEffect(
    () => () => {
      active.current = false;
    },
    [],
  );

  async function remove() {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      await api.removeUnimported(wid, [name]);
      if (!active.current) return;
      toast(`已删除「${name}」`);
      onRemoved();
      onClose();
    } catch (reason) {
      if (active.current) setError(reportError(reason) ?? "");
    } finally {
      submitting.current = false;
      if (active.current) setPending(false);
    }
  }

  return (
    <DialogShell
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      flight={pending}
      closeTip={pending ? "关闭不等于撤销删除" : undefined}
      title={
        <Tip label={`删除未导入文件「${name}」？`}>
          <span className="block truncate">删除未导入文件「{name}」？</span>
        </Tip>
      }
      cancel={{ label: "取消", variant: "secondary", onClick: onClose }}
      confirm={{
        label: "删除",
        variant: "danger-text",
        onClick: () => void remove(),
      }}
    >
      <p className="text-t-md text-text-3">此文件将从本地永久删除。</p>
      {error && (
        <FormError data-dialog-error="" className="text-t-sm text-bad-ink">
          {error}
        </FormError>
      )}
    </DialogShell>
  );
}
