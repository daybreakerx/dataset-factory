import type { ReactElement } from "react";
import { useSyncExternalStore } from "react";
import {
  getToastSnapshot,
  pauseToast,
  removeToast,
  resumeToast,
  subscribeToast,
} from "../../lib/toast";
import { cn } from "../../lib/utils";

/**
 * 浮层提示的渲染端（浮层体系里的 Toast）。
 *
 * 形态照设计规范的 `.toast`：黑底白字（全站唯一一处黑底浮层，暗色随 n-900 / n-0
 * 自动翻成浅底深字）、居中贴底、`--r-md` 圆角、宽度上限 420px 超出折行；驻留 5 秒，
 * 淡入淡出都走 --dur-1。条是纯展示层（overlay.md「Toast」段）：不可点、不聚焦、
 * 文字不可选；条本体接指针只为悬停暂停驻留，锚定层保持 pointer-events: none。
 */
export function ToastViewport({ className }: { className?: string }): ReactElement {
  const items = useSyncExternalStore(subscribeToast, getToastSnapshot);
  return (
    <div
      role="status"
      // aria-live 必须显式写：Radix 弹窗打开时 hideOthers() 只对带 aria-live 属性的元素
      // 开例外，只写 role="status" 的话提示条在模态期间被整块标 aria-hidden、读屏念不到。
      aria-live="polite"
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-6 z-(--z-toast) flex flex-col items-center gap-2 px-4",
        className,
      )}
    >
      {items.map((item) => (
        // biome-ignore lint/a11y/noStaticElementInteractions: 条是纯展示层（不可点、不聚焦），接指针只为悬停暂停驻留与淡出后摘除
        <div
          key={item.id}
          data-leaving={item.leaving || undefined}
          onMouseEnter={() => pauseToast(item.id)}
          onMouseLeave={() => resumeToast(item.id)}
          onTransitionEnd={(event) => {
            if (item.leaving && event.propertyName === "opacity") {
              removeToast(item.id);
            }
          }}
          className={cn(
            // 入场淡入与出场淡出走同一条 --dur-1：duration 同时喂 animate-in 的
            // --tw-duration 与 transition-duration；出场 = 撤透明度，过渡走完再摘。
            "pointer-events-auto select-none max-w-[min(70vw,420px)] rounded-lg bg-n-900 px-4 py-2 text-center text-t-md leading-(--lh-base) text-n-0 wrap-anywhere",
            "animate-in fade-in-0 transition-opacity duration-(--dur-1)",
            item.leaving && "opacity-0",
          )}
        >
          {item.text}
        </div>
      ))}
    </div>
  );
}
