import type { components } from "../../../api-types.gen";
import { HScroll } from "../../../components/hs-scroll";
import { Tip } from "../../../components/ui/tooltip";

/**
 * 对比名单的替换式上限（稿⑥）：当前策略恒打头、永不被踢，其余最多两套——
 * 到顶不置灰，点新的那枚踢掉最早加入的那套。
 */
export function nextCompared(previous: readonly string[], id: string): string[] {
  const next = previous.includes(id)
    ? previous.filter((existing) => existing !== id)
    : [...previous, id];
  return next.slice(Math.max(0, next.length - 2));
}

interface Props {
  batch: string;
  batches: readonly components["schemas"]["BatchView"][];
  /** 当前批次之外、处于激活态、可参与对比的批次（由父层从批次清单筛出）。 */
  available: components["schemas"]["BatchView"][];
  /** 已选中参与对比的批次 id（当前批次固定为第一栏，不在此列）。 */
  compared: string[];
  onToggle: (id: string) => void;
}

/** 策略对比胶囊条（稿 §23 .live-head 右端）：当前策略恒在最左、点它不动，其余加入即多栏对比，无上限置灰。 */
export function ComparePicker({
  batch,
  batches,
  available,
  compared,
  onToggle,
}: Props) {
  return (
    // 占满题字右侧剩余宽度（⑨）；窄视口（≤768）收到 304 保底、题字恒不让位。
    <section
      className="min-w-0 flex-1 max-md:grow-0 max-md:basis-[304px]"
      aria-label="策略对比"
    >
      {/* 单行横滚走 hs 定式（DESIGN.md 3.3）：对齐声明挂在 wrap 上而非 .hs-scroll。 */}
      <HScroll className="justify-end">
        {[
          {
            id: batch,
            name: batches.find((entry) => entry.id === batch)?.name ?? batch,
          },
          ...available,
        ].map((entry) => {
          const primary = entry.id === batch;
          const selected = primary || compared.includes(entry.id);
          return (
            <Tip key={entry.id} label={primary ? "当前策略固定为第一栏" : entry.name}>
              {/* §23 实例约束：两类选中同色、靠位置区分（当前那枚恒在最左），零图形、不换行。 */}
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => !primary && onToggle(entry.id)}
                className={`h-(--h-xs) min-w-[88px] shrink-0 justify-center gap-1 rounded-full border px-3 text-t-sm whitespace-nowrap ${
                  selected
                    ? "border-primary bg-primary/10 font-medium text-primary dark:bg-primary/26"
                    : "border-border bg-secondary text-text-3"
                } ${primary ? "cursor-default" : "cursor-pointer"}`}
              >
                {entry.name} · {entry.id}
              </button>
            </Tip>
          );
        })}
      </HScroll>
    </section>
  );
}
