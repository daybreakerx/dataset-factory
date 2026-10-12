/**
 * 页头「关闭服务」按钮 + 确认弹窗（F6）。
 *
 * 确认后调停机接口：服务把手头请求做完再退出。图标态用于页头与侧栏底部钮组（原「服务运行」
 * 子页的文字态随该子页 2026-10-05 改版撤除）。
 *
 * 正文只在「关了会丢东西」时出话（2026-10-06 用户两轮裁）：原先那句基句说「不会中断生成」，
 * 而跑批线程随进程被杀、并不留中断终态——那句是假话，整句撤、不补替换句；取而代之是条件
 * 警告行，两路各自成立：设置页有未保存修改（壳层上提的 dirty）／后端 `/api/service/busy`
 * 报有在飞的跑批或任务。开窗时查一次即定，开窗期间新起的任务不再追。
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
  const [hasRunning, setHasRunning] = useState(false);

  const openDialog = (): void => {
    setOpen(true);
    setError(null);
    setHasRunning(false);
    // 读数只为决定那一行警告要不要出：查不到就当没有（宁可少一句提醒，也不拿猜测拦人）。
    void api.getServiceBusy().then(
      (value) => setHasRunning(value.runs + value.tasks > 0),
      () => undefined,
    );
  };

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
            onClick={openDialog}
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
        flight={busy}
        footLine={dirty || hasRunning || error !== null}
        cancel={{ label: "取消", flight: false, onClick: () => setOpen(false) }}
        confirm={{
          label: "关闭服务",
          variant: "danger-text",
          onClick: () => void shutdown(),
        }}
      >
        {dirty && (
          // 警告行（稿 base.css §13 .modal-warn 等价）：与 .modal-error 同构、warn 语义色；
          // 说的对象是界面未保存编辑（与下一行的「未完成的任务」并读不冲突）。
          <span className="block text-t-sm text-warn-ink">
            有未保存的修改，关闭后将丢失。
          </span>
        )}
        {hasRunning && (
          <span className="block text-t-sm text-warn-ink">
            当前有正在进行中的任务，关闭会丢失未完成的部分。
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
