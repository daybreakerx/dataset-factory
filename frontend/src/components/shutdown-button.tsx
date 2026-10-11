/**
 * 页头「关闭服务」按钮 + 确认弹窗（F6）。
 *
 * 确认后调停机接口：服务把手头请求做完再退出，会话数据已实时落盘。图标态用于页头
 * 与侧栏底部钮组（原「服务运行」子页的文字态随该子页 2026-10-05 改版撤除）。
 * dirty（设置页两面板有未保存修改，壳层上提的值）时弹窗正文句下加一行警告
 * 「有未保存的修改，关闭后将丢失。」——确认即关机不保存；非 dirty 不出该行、
 * 弹窗其余形态不变（关机确认弹窗 dirty 态「合并一窗」）。
 */
import { PowerIcon } from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";

import { api } from "../api";
import { reportError } from "../lib/feedback";
import { DialogShell } from "./dialog-shell";
import { FormError } from "./form-error";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function ShutdownButton({
  sidebar = false,
  dirty = false,
}: {
  sidebar?: boolean;
  /** 设置页两面板有未保存修改（App 壳层上提）：弹窗加警告行，确认即关机、不保存。 */
  dirty?: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shutdown = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.shutdownService();
      setOpen(false);
      // 停机被受理 = 服务开始排入手头请求。状态点监听此事件转「正在停止」，
      // 并在确认期里逐秒重查，探到不通就定在红点（与脚本直接杀进程的表现收敛到同一处）。
      window.dispatchEvent(new Event("df:service-stopping"));
    } catch (err) {
      const text = reportError(err);
      if (text !== null) setError(text);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant={sidebar ? "ghost" : "outline"}
            size="icon"
            className={
              sidebar
                ? // 侧栏图标态撤红改黑（「黑」的规范形态＝text-1，暗色自动翻白）、
                  // 悬停底走 --accent 半透明墨，与同排钮一致（base.css §5 side-foot）。
                  "text-text-1 hover:bg-accent"
                : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            }
            aria-label="关闭服务"
            onClick={() => setOpen(true)}
          >
            <PowerIcon className="size-(--icon-md)" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>关闭服务</TooltipContent>
      </Tooltip>
      <DialogShell
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) {
            setError(null);
          }
        }}
        title="关闭服务？"
        description="关闭前会等正在进行的请求跑完，不会中断生成；会话数据已实时保存、不受影响。"
        flight={busy}
        cancel={{ label: "取消", flight: false, onClick: () => setOpen(false) }}
        confirm={{
          label: "关闭服务",
          variant: "danger-text",
          onClick: () => void shutdown(),
        }}
      >
        {dirty && (
          // 警告行（稿 base.css §13 .modal-warn 等价）：与 .modal-error 同构、warn 语义色；
          // 说的对象是界面未保存编辑（正文句说的是会话数据，并读不冲突）。
          <span className="block text-t-sm text-warn-ink">
            有未保存的修改，关闭后将丢失。
          </span>
        )}
        {error !== null && (
          <FormError data-dialog-error className="text-t-sm text-bad-ink">
            {error}
          </FormError>
        )}
      </DialogShell>
    </>
  );
}
