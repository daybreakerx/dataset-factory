import { useEffect, useRef, useState } from "react";
import { api } from "../../../api";
import type { components } from "../../../api-types.gen";
import { DialogShell } from "../../../components/dialog-shell";
import { FormError } from "../../../components/form-error";
import { Tip } from "../../../components/ui/tooltip";
import { reportError } from "../../../lib/feedback";
import { formatBytes } from "../../../lib/format";
import { toast } from "../../../lib/toast";

export function DeleteWorkdirDialog({
  wid,
  name,
  onClose,
  onDeleted,
}: {
  wid: string;
  /** 目录显示名：标题带对象名（删除类弹窗族形），读取中也得在场，故由宿主传入。 */
  name: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [preview, setPreview] = useState<
    components["schemas"]["DeletionPreview"] | null
  >(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const generation = useRef(0);
  const active = useRef(true);
  useEffect(
    () => () => {
      active.current = false;
    },
    [],
  );

  useEffect(() => {
    const token = ++generation.current;
    setPreview(null);
    setLoading(true);
    setError("");
    void api
      .previewWorkdirDeletion(wid)
      .then(
        (value) => {
          if (token === generation.current) setPreview(value);
        },
        (reason: unknown) => {
          if (token !== generation.current) return;
          const text = reportError(reason);
          if (text !== null) setError(text);
        },
      )
      .finally(() => {
        if (token === generation.current) setLoading(false);
      });
    return () => {
      generation.current += 1;
    };
  }, [wid]);

  async function remove() {
    if (pending.current || !preview) return;
    pending.current = true;
    const path = preview.path;
    setBusy(true);
    setError("");
    try {
      const result = await api.deleteWorkdir(wid, path);
      // 成功出口归宿主：飞行期关了窗也要走到（删完却停在已删目录的设置页＝假现场）。
      if (result.deleted) onDeleted();
      else showFailure(`删除未完成，残留目录：${result.remaining_path ?? path}。`);
    } catch (reason) {
      const text = reportError(reason);
      if (text !== null) showFailure(text);
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  }

  /** 失败句：窗还在就落就地红字，窗已被关掉就改浮层提示（同一条真话，换个说得着的地方）。 */
  function showFailure(text: string): void {
    if (active.current) setError(text);
    else toast(text);
  }

  return (
    <DialogShell
      open
      onOpenChange={(open) => {
        // 族规则「退出 ≠ 撤销」：飞行期照常可退，删除请求不受关窗影响。
        if (!open) onClose();
      }}
      className="max-h-[90dvh] overflow-y-auto"
      footLine
      title={
        <Tip label={`删除工作目录「${name}」？`}>
          <span className="block truncate">删除工作目录「{name}」？</span>
        </Tip>
      }
      closeTip={busy ? "关闭不等于撤销删除" : undefined}
      note={preview && !error ? "此操作不可撤销" : undefined}
      cancel={{ label: "取消", variant: "secondary", onClick: onClose }}
      confirm={{
        label: busy ? "正在删除" : "确认删除",
        variant: "danger-text",
        disabled: loading || !preview || error !== "",
        onClick: () => void remove(),
      }}
      flight={busy}
    >
      {loading && <p role="status">正在读取删除范围</p>}
      {preview && (
        <div className="space-y-2 text-t-sm">
          <p className="break-all">
            {preview.path} · {preview.file_count} 个文件 ·{" "}
            {formatBytes(preview.total_bytes, "MB", 2)}
          </p>
          <p className={preview.original_materials ? "text-bad-ink" : "text-warn-ink"}>
            {preview.confirmation}
          </p>
        </div>
      )}
      {error && (
        <FormError data-dialog-error className="break-all text-t-sm text-bad-ink">
          {error}
        </FormError>
      )}
    </DialogShell>
  );
}
