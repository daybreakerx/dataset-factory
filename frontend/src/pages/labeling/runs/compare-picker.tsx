import type { components } from "../../../api-types.gen";
import { HScroll } from "../../../components/hs-scroll";
import { Tip } from "../../../components/ui/tooltip";

interface Props {
  batch: string;
  batches: readonly components["schemas"]["BatchView"][];
  /** 当前批次之外、处于激活态、可参与对比的批次（由父层从批次清单筛出）。 */
  available: components["schemas"]["BatchView"][];
  /** 已选中参与对比的批次 id（当前批次固定为第一栏，不在此列）。 */
  compared: string[];
  onToggle: (id: string) => void;
}

/** 产物预览的策略对比选择器：当前策略固定第一栏，其余激活批次最多再选两套。 */
export function ComparePicker({
  batch,
  batches,
  available,
  compared,
  onToggle,
}: Props) {
  return (
    <section className="mb-2 ml-auto max-w-[304px]" aria-label="策略对比">
      {/* 对比 chips 条（条目预览稿已产出区同款）：单行横滚走 hs 定式（DESIGN.md 3.3）——
          原生条占位与 pb-2 随之撤；wrap 级 justify-end＝少时靠右、多时整条横滚。 */}
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
            <Tip
              key={entry.id}
              label={
                primary
                  ? "当前策略固定为第一栏"
                  : !selected && compared.length >= 2
                    ? "同时最多对比三套策略"
                    : entry.name
              }
            >
              <button
                type="button"
                aria-pressed={selected}
                disabled={primary || (!selected && compared.length >= 2)}
                onClick={() => onToggle(entry.id)}
                className={`h-(--h-xs) min-w-[88px] shrink-0 rounded-full border px-4 text-t-sm ${primary ? "border-primary/45 bg-primary/10 font-medium text-primary dark:bg-primary/26" : selected ? "border-border bg-card text-foreground" : "border-border bg-secondary text-text-3"}`}
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
