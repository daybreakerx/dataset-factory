/**
 * 浮层提示（toast）的状态源。
 *
 * 做成模块级存储而不是 Context：投递点散落在各个 catch 分支（连不上后端的错误到处都可能
 * 发生），用 Context 就得给每处接一个 hook、给每个测试外壳补一层 Provider；而它本身只是
 * 一个「短寿命的字符串清单」，没有配置项需要向下传递。渲染端见 `components/ui/toast.tsx`。
 */

export interface ToastItem {
  id: number;
  text: string;
  /** 出场淡出中：驻留已到、 opacity 过渡走完才真摘（摘除前界面先淡出）。 */
  leaving: boolean;
}

/** 驻留时长 5s（overlay.md「Toast」段：驻留 5s 后自灭；2026-10-01 用户裁「统一 5s」）。 */
const LIFETIME_MS = 5000;

/** 出场兜底时限：正常路径由条本体的 opacity 过渡结束事件（transitionend）提前摘除，
 * 这只是事件不来的场合（如 reduced-motion 降级把过渡时长归零、事件不再触发）的最后一道
 * 兜底——取 --dur-1（120ms）的两倍余，不为等待写死过渡时长。 */
const EXIT_FALLBACK_MS = 250;

let items: readonly ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, number>(); // 驻留计时句柄
const deadlines = new Map<number, number>(); // 驻留到期时刻（暂停时折算剩余）
const paused = new Map<number, number>(); // 暂停中的剩余驻留
const exits = new Map<number, number>(); // 出场兜底计时句柄

function emit(): void {
  for (const listener of listeners) listener();
}

function clearHandle(handles: Map<number, number>, id: number): void {
  const handle = handles.get(id);
  if (handle !== undefined) {
    window.clearTimeout(handle);
    handles.delete(id);
  }
}

/** 驻留计时（重新计满；暂停中的剩余一并作废）。 */
function schedule(id: number, duration: number = LIFETIME_MS): void {
  clearHandle(timers, id);
  paused.delete(id);
  deadlines.set(id, Date.now() + duration);
  timers.set(
    id,
    window.setTimeout(() => beginExit(id), duration),
  );
}

/** 驻留到 → 进出场淡出：先标记 leaving 让界面撤不透明度，过渡走完（或兜底时限到）再真摘。 */
function beginExit(id: number): void {
  clearHandle(timers, id);
  deadlines.delete(id);
  if (!items.some((item) => item.id === id)) return;
  items = items.map((item) => (item.id === id ? { ...item, leaving: true } : item));
  clearHandle(exits, id);
  exits.set(
    id,
    window.setTimeout(() => remove(id), EXIT_FALLBACK_MS),
  );
  emit();
}

function remove(id: number): void {
  clearHandle(timers, id);
  clearHandle(exits, id);
  deadlines.delete(id);
  paused.delete(id);
  items = items.filter((item) => item.id !== id);
  emit();
}

/**
 * 投递一条提示；同样的文案已在屏上时只把它的时间续上，不再叠第二条。
 *
 * 去重是必要的：服务关闭后一次页面重挂载会并发失败好几个请求，不去重就会一次弹出好几条
 * 一模一样的提示，跟用户原来抱怨的「两处报错框」是同一个毛病，只是换了形态。出场中的
 * 同文案先拉回屏上，再重计满驻留。
 */
export function toast(text: string): void {
  const shown = items.find((item) => item.text === text);
  if (shown !== undefined) {
    if (shown.leaving) {
      items = items.map((item) =>
        item.id === shown.id ? { ...item, leaving: false } : item,
      );
      clearHandle(exits, shown.id);
    }
    schedule(shown.id);
    emit();
    return;
  }
  const id = nextId;
  nextId += 1;
  items = [...items, { id, text, leaving: false }];
  schedule(id);
  emit();
}

/** 暂停某一条的驻留计时（悬停暂停按条：只停指针所在那条，同屏其余照常走）。 */
export function pauseToast(id: number): void {
  const handle = timers.get(id);
  if (handle === undefined) return; // 不在驻留期（已出场或已摘）——无视
  window.clearTimeout(handle);
  timers.delete(id);
  const deadline = deadlines.get(id) ?? Date.now();
  deadlines.delete(id);
  paused.set(id, Math.max(deadline - Date.now(), 0));
}

/** 恢复被暂停那条的驻留计时：按剩余时间续算，不重新计满。 */
export function resumeToast(id: number): void {
  const remaining = paused.get(id);
  if (remaining === undefined) return; // 没有暂停中的驻留（出场期不接暂停）
  paused.delete(id);
  if (remaining <= 0) {
    beginExit(id);
    return;
  }
  timers.set(
    id,
    window.setTimeout(() => beginExit(id), remaining),
  );
}

/** 过渡走完后的真摘除（渲染端在 opacity 过渡结束事件里调用）。 */
export function removeToast(id: number): void {
  remove(id);
}

export function subscribeToast(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** `useSyncExternalStore` 的快照：数组只在增删与进出出场态时换引用，平时保持稳定。 */
export function getToastSnapshot(): readonly ToastItem[] {
  return items;
}
