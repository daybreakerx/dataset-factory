/**
 * 单行横滚区（DESIGN.md 3.3「横向滚动条通用规范」、base.css §20 横向版的组件化；
 * 取值类在 globals.css「横向滚动区 hs 定式」段，拇指色等走 tokens 不在本组件）。
 * 原生滚动条隐藏、自绘拇指条贴底重叠不占竖向空间；悬停该区且溢出才显形、可拖动；
 * 纵滚轮转横滚；两侧渐隐位置感知——仅该侧还有内容才渐隐、滚到尽头即消失。
 */
import { type ReactElement, type ReactNode, useEffect, useRef } from "react";

import { cn } from "../lib/utils";

export function HScroll({
  className,
  trackClassName,
  children,
}: {
  /** 挂 hs-wrap 的附加类（flex-1 / justify-end 等布局档）。 */
  className?: string;
  /** 挂 hs-scroll 轨道的附加类（实例覆盖默认间距等）。 */
  trackClassName?: string;
  children?: ReactNode;
}): ReactElement {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (track === null || thumb === null) return;
    const wrap = track.parentElement;
    if (wrap === null) return;

    const update = (): void => {
      const sw = track.scrollWidth;
      const cw = track.clientWidth;
      if (sw <= cw + 1) {
        thumb.classList.remove("hs-on");
        wrap.classList.remove("hs-fade-l", "hs-fade-r");
        return;
      }
      thumb.classList.add("hs-on");
      wrap.classList.toggle("hs-fade-l", track.scrollLeft > 0);
      wrap.classList.toggle("hs-fade-r", track.scrollLeft + cw < sw);
      // 几何同稿侧脚本：拇指最短 24，宽随内容占比、位随滚动占比。
      thumb.style.width = `${Math.max(24, (cw / sw) * cw)}px`;
      thumb.style.left = `${(track.scrollLeft / sw) * cw}px`;
    };

    // 纵滚轮转横滚：主分量是纵向且已溢出才接管（横向主分量时交浏览器自己滚）。
    const onWheel = (event: WheelEvent): void => {
      if (track.scrollWidth <= track.clientWidth) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      track.scrollLeft += event.deltaY;
      event.preventDefault();
    };

    // 收尾引用提出作用域：卸载时若正拖着，也要把 window 监听摘干净。
    let onDragEnd: (() => void) | null = null;
    const onThumbPointerDown = (event: PointerEvent): void => {
      event.preventDefault();
      thumb.classList.add("hs-drag");
      const startX = event.clientX;
      const startScroll = track.scrollLeft;
      const sw = track.scrollWidth;
      const cw = track.clientWidth;
      const tw = Number.parseFloat(thumb.style.width) || cw;
      const handleMove = (moveEvent: PointerEvent): void => {
        track.scrollLeft =
          startScroll +
          ((moveEvent.clientX - startX) * (sw - cw)) / Math.max(1, cw - tw);
      };
      const handleEnd = (): void => {
        thumb.classList.remove("hs-drag");
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleEnd);
      };
      onDragEnd = handleEnd;
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleEnd);
    };

    track.addEventListener("scroll", update);
    track.addEventListener("wheel", onWheel, { passive: false });
    thumb.addEventListener("pointerdown", onThumbPointerDown);
    // 内容异步落位后 scrollWidth 变化不伴随 scroll 事件——观察尺寸补 update（vscroll 同款）。
    // jsdom 等无布局环境没有 ResizeObserver：跳过观察，update 由 scroll 事件与挂载时兜底。
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(track);
    update();

    return () => {
      track.removeEventListener("scroll", update);
      track.removeEventListener("wheel", onWheel);
      thumb.removeEventListener("pointerdown", onThumbPointerDown);
      onDragEnd?.();
      observer?.disconnect();
    };
  }, []);

  return (
    <div className={cn("hs-wrap", className)}>
      <div ref={trackRef} className={cn("hs-scroll", trackClassName)}>
        {children}
      </div>
      <div ref={thumbRef} aria-hidden className="hs-thumb" />
    </div>
  );
}
