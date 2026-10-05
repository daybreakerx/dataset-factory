/**
 * 设置面板窄屏列表展收（对齐批「窄屏列表展收 · 两态交互实现」；规格权威＝零件稿
 * 窄屏列表展收.html、态类 base.css §21）：<768 时左列收起为自动默认，详情头最左的
 * 展开钮承担「展开」——悬停／键盘 Enter／Space 进暂展浮出层（叠详情上、详情不位移），
 * Esc／层头返回钮／点行收起。端点与技能两面板同构共用；≥768 两列常驻、展收交互整体
 * 不存在（断点跨线复位收起）。
 */
import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMediaQuery } from "../../hooks/use-media-query";

/** 窄屏断点：与稿 base.css <768 块同值（767.98px 防亚像素跨界）。 */
const NARROW_QUERY = "(max-width: 767.98px)";

export function usePeekList(): {
  /** 窄屏（<768）：展收交互只在窄屏存在，宽屏恒 false。 */
  narrow: boolean;
  /** 暂展（浮出层）态；收起为窄屏默认，宽屏恒 false。 */
  peek: boolean;
  /** 详情头展开钮落点（收起后焦点回它）。 */
  toggleRef: RefObject<HTMLButtonElement | null>;
  /** 层头返回钮落点（键盘进暂展的首件）。 */
  backRef: RefObject<HTMLButtonElement | null>;
  /** 进暂展。focusBack＝键盘路径（展开钮上 Enter／Space）时焦点入层、首件即返回钮。 */
  openPeek: (focusBack: boolean) => void;
  /** 收起。refocus＝键盘路径（Esc／返回钮）时焦点回展开钮；指针路径不夺焦点。 */
  closePeek: (refocus: boolean) => void;
} {
  const narrow = useMediaQuery(NARROW_QUERY);
  const [peek, setPeek] = useState(false);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const backRef = useRef<HTMLButtonElement | null>(null);
  // 焦点落位要等态渲染完成（返回钮随层挂载、展开钮随层收回可见），挂到 effect 落。
  const pendingFocusRef = useRef<"back" | "toggle" | null>(null);

  // 断点跨线复位收起：≥768 展收交互整体不存在，暂展态一并作废。
  useEffect(() => {
    if (!narrow) setPeek(false);
  }, [narrow]);

  const openPeek = useCallback((focusBack: boolean): void => {
    if (focusBack) pendingFocusRef.current = "back";
    setPeek(true);
  }, []);

  const closePeek = useCallback((refocus: boolean): void => {
    if (refocus) pendingFocusRef.current = "toggle";
    setPeek(false);
  }, []);

  // Esc 收起、焦点回展开钮（键盘路径）。弹窗已处理的 Esc（Radix 会 preventDefault）
  // 不重复收——弹窗在场时只让弹窗吃这一下。
  useEffect(() => {
    if (!peek) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.key !== "Escape") return;
      closePeek(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [peek, closePeek]);

  // 焦点落位：进暂展 → 层头返回钮；收起 → 详情头展开钮（键盘路径）。
  // 目标与态匹配才落（暂展落返回钮、收起落展开钮），态未变不重复夺焦。
  useEffect(() => {
    const want = pendingFocusRef.current;
    if (want === null || (want === "back") !== peek) return;
    pendingFocusRef.current = null;
    const target = want === "back" ? backRef.current : toggleRef.current;
    target?.focus();
  }, [peek]);

  return { narrow, peek, toggleRef, backRef, openPeek, closePeek };
}
