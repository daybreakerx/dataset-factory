/**
 * 竖向列内滚自绘滚动条（base.css §20 竖向版、原型侧 assets/vscroll.js 逻辑的组件化）。
 * 列内滚区隐藏原生滚动条（配 globals.css `.vscroll-y`），自绘拇指条＋上下步进钮挂在
 * 最近定位祖先（面板根，`position: relative` 由面板根承担）；几何随滚动／容器尺寸实时更新。
 * 显隐＝悬停所在列或部件自身（列与部件成对配对监听，无「离开面板不撤」漏洞）；
 * 按溢出启停（不溢出整组不渲染）；拇指可拖动；步进钮点击 ±40px、按住 300ms 后连发。
 * 取值权威＝base.css §20（.vthumb/.vbtn 类在 globals.css）。
 */

import type { RefObject } from "react";
import { useEffect, useRef } from "react";

const BTN_H = 14;
const STEP = 40;
/** 步进钮连发参数（原型脚本同值）：按住 300ms 后以 50ms/步连发。 */
const HOLD_DELAY = 300;
const HOLD_INTERVAL = 50;
const CHEVRON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

export function useVscrollColumn<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const base = el.offsetParent;
    if (base === null) return;

    const thumb = document.createElement("div");
    thumb.className = "vthumb";
    const btnUp = document.createElement("button");
    btnUp.type = "button";
    btnUp.className = "vbtn vbtn--up";
    btnUp.setAttribute("aria-label", "向上滚动");
    btnUp.innerHTML = CHEVRON;
    const btnDn = document.createElement("button");
    btnDn.type = "button";
    btnDn.className = "vbtn vbtn--dn";
    btnDn.setAttribute("aria-label", "向下滚动");
    btnDn.innerHTML = CHEVRON;
    base.appendChild(btnUp);
    base.appendChild(thumb);
    base.appendChild(btnDn);
    const parts = [thumb, btnUp, btnDn];

    const update = (): void => {
      const sh = el.scrollHeight;
      const ch = el.clientHeight;
      if (sh <= ch + 1) {
        for (const p of parts) p.style.display = "none";
        return;
      }
      for (const p of parts) p.style.display = "";
      const pr = base.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      const topIn = er.top - pr.top;
      const right = Math.max(3, pr.right - er.right + 3);
      const trackTop = topIn + 2 + BTN_H + 2;
      const track = ch - 4 - 2 * (BTN_H + 2);
      const th = Math.max(24, (ch / sh) * track);
      const ty = sh - ch ? (el.scrollTop / (sh - ch)) * (track - th) : 0;
      thumb.style.height = `${th}px`;
      thumb.style.top = `${trackTop + ty}px`;
      btnUp.style.top = `${topIn + 2}px`;
      btnDn.style.top = `${er.bottom - pr.top - 2 - BTN_H}px`;
      thumb.style.right = `${right}px`;
      // 钮宽 12／拇指 4：右缘差 4 → 中心线同列（原型脚本同式）。
      btnUp.style.right = `${right - 4}px`;
      btnDn.style.right = `${right - 4}px`;
    };

    el.addEventListener("scroll", update);
    // 数据异步落位后 scrollHeight 变化不伴随 scroll/resize 事件——观察容器尺寸补 update。
    const observer = new ResizeObserver(update);
    observer.observe(el);
    update();

    const enter = (): void => {
      for (const q of parts) q.classList.add("hov");
    };
    const leave = (): void => {
      for (const q of parts) q.classList.remove("hov");
    };
    for (const target of [el, thumb, btnUp, btnDn]) {
      target.addEventListener("mouseenter", enter);
      target.addEventListener("mouseleave", leave);
    }

    const onThumbPointerDown = (event: PointerEvent): void => {
      event.preventDefault();
      const startY = event.clientY;
      const startScroll = el.scrollTop;
      const th = Number.parseFloat(thumb.style.height) || el.clientHeight;
      const onMove = (ev: PointerEvent): void => {
        const ch = el.clientHeight;
        const sh = el.scrollHeight;
        el.scrollTop =
          startScroll + ((ev.clientY - startY) * (sh - ch)) / Math.max(1, ch - th);
      };
      const onUp = (): void => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };
    thumb.addEventListener("pointerdown", onThumbPointerDown);

    const bindStep = (btn: HTMLButtonElement, dir: -1 | 1): (() => void) => {
      let timer: number | null = null;
      let delay: number | null = null;
      const stop = (): void => {
        if (timer !== null) clearInterval(timer);
        if (delay !== null) clearTimeout(delay);
        timer = delay = null;
        window.removeEventListener("pointerup", stop);
      };
      btn.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        el.scrollTop += dir * STEP;
        delay = window.setTimeout(() => {
          timer = window.setInterval(() => {
            el.scrollTop += dir * STEP;
          }, HOLD_INTERVAL);
        }, HOLD_DELAY);
        window.addEventListener("pointerup", stop);
      });
      btn.addEventListener("pointerleave", stop);
      return stop;
    };
    const stopUp = bindStep(btnUp, -1);
    const stopDn = bindStep(btnDn, 1);

    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
      thumb.removeEventListener("pointerdown", onThumbPointerDown);
      for (const target of [el, thumb, btnUp, btnDn]) {
        target.removeEventListener("mouseenter", enter);
        target.removeEventListener("mouseleave", leave);
      }
      btnUp.removeEventListener("pointerleave", stopUp);
      btnDn.removeEventListener("pointerleave", stopDn);
      stopUp();
      stopDn();
      for (const p of parts) p.remove();
    };
  }, []);

  return ref;
}
