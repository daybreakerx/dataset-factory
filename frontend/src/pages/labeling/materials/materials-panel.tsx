import { ChevronDownIcon, SearchIcon } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { useMemo } from "react";
import { Button } from "../../../components/ui/button";
import { Tip } from "../../../components/ui/tooltip";
import { usePersistedState } from "../../../hooks/use-persisted-state";
import type { BatchSelection } from "../batching/BatchSelector";
import {
  groupedItems,
  ITEM_GROUPS,
  type ItemMap,
  type ItemRow,
  itemKey,
} from "../runs/items-state";
import { MaterialRow } from "./material-row";

/** 「一键导入」弹窗的请求形状（面板组头按钮与页面 recover 共用）。 */
export interface RecoveryRequest {
  names: string[];
  mode: "copy" | "restore" | "inplace";
}

/** 素材条目左列：条目头＋搜索＋分组列表。筛选词 / 折叠 / 组内展开为本块私有持久化态。 */
export function MaterialsPanel({
  items,
  selection,
  loading,
  saving,
  selectionMode,
  setSelectionMode,
  checked,
  setChecked,
  toggleCheck,
  addSelected,
  removeRetry,
  setRetryRequest,
  setRecovery,
  selectedItem,
  choose,
  recover,
  requestRemoval,
}: {
  items: ItemMap;
  selection: BatchSelection | null;
  loading: boolean;
  saving: boolean;
  selectionMode: boolean;
  setSelectionMode: Dispatch<SetStateAction<boolean>>;
  checked: ReadonlySet<string>;
  setChecked: Dispatch<SetStateAction<ReadonlySet<string>>>;
  toggleCheck: (item: string) => void;
  addSelected: () => Promise<void>;
  removeRetry: (item?: string) => Promise<void>;
  setRetryRequest: Dispatch<SetStateAction<number>>;
  setRecovery: Dispatch<SetStateAction<RecoveryRequest | null>>;
  selectedItem: string | null;
  choose: (row: ItemRow) => void;
  recover: (row: ItemRow) => void;
  requestRemoval: (row: ItemRow) => void;
}) {
  // 左列筛选词跨重启持久化：搜索到一半重启，回来还在。
  const [query, setQuery] = usePersistedState<string>("dsf-labeling-query", "");
  const [collapsed, setCollapsed] = usePersistedState<ReadonlySet<string>>(
    "dsf-labeling-collapsed",
    new Set(),
  );
  // V3（2026-09-21 审计）：组内默认只展示 4 行，点开才全量——与分组折叠（collapsed）
  // 是两个独立维度：collapsed 管「整个组收不收」，expanded 管「组内截断放不放开」。
  const [expandedGroups, setExpandedGroups] = usePersistedState<ReadonlySet<string>>(
    "dsf-labeling-expanded-groups",
    new Set(),
  );
  const filtered = useMemo(() => groupedItems(items, query), [items, query]);
  // L11：搜索计数要能看出「一共多少条」——无过滤分组是总数基准。
  const unfiltered = useMemo(() => groupedItems(items, ""), [items]);

  return (
    <aside
      className="flex max-h-80 w-full shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card lg:max-h-none lg:w-(--w-col-left)"
      aria-label="素材条目"
    >
      <div className="flex min-h-10 items-center gap-2 px-3 py-2 text-t-sm">
        <span className="mr-auto text-t-md font-medium">条目</span>
        {selectionMode && (
          <>
            <span className="shrink-0 tabular-nums">已选 {checked.size}</span>
            <Button
              variant="ghost"
              size="sm"
              disabled={saving || !checked.size}
              onClick={() => setChecked(new Set())}
            >
              清空选择
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={saving || !checked.size}
              onClick={() => void addSelected()}
            >
              加入重试
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={saving || !selection || loading}
          onClick={() => {
            setSelectionMode((value) => !value);
            setChecked(new Set());
          }}
        >
          {selectionMode ? "退出选择" : "选择"}
        </Button>
      </div>
      <div className="mr-3 mb-2 ml-4 flex h-(--h-sm) shrink-0 items-center gap-2 rounded-md border border-input bg-card px-2">
        <SearchIcon className="size-3 shrink-0 text-text-3" />
        <input
          className="min-w-0 flex-1 border-0 bg-transparent text-t-sm text-text-2 outline-none placeholder:text-n-400"
          aria-label="搜索条目"
          placeholder="搜索条目"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto" aria-busy={loading}>
        {loading && <p className="p-3 text-t-sm text-muted-foreground">正在加载</p>}
        {!loading && !selection && (
          <p className="p-3 text-t-sm text-muted-foreground">还没有可用批次</p>
        )}
        {selection &&
          ITEM_GROUPS.map(([key, label]) => (
            <section key={key} aria-label={label}>
              <div
                className={`sticky top-0 z-10 flex items-center gap-2 border-b border-border/60 border-l-[3px] bg-card px-4 py-2 text-t-md font-medium ${key === "queued" ? "border-l-primary" : key === "done" ? "border-l-ok-ink" : key === "failed" ? "border-l-bad-ink" : key === "retry" ? "border-l-info-ink" : "border-l-n-400"}`}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  aria-expanded={!!query || !collapsed.has(key)}
                  onClick={() =>
                    setCollapsed((previous) => {
                      const next = new Set(previous);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    })
                  }
                >
                  <ChevronDownIcon
                    className={`size-3.5 shrink-0 text-text-3 ${!query && collapsed.has(key) ? "-rotate-90" : ""}`}
                  />
                  {label}
                  <span
                    className={`text-t-xs tabular-nums ${key === "queued" ? "text-primary" : key === "done" ? "text-ok-ink" : key === "failed" ? "text-bad-ink" : key === "retry" ? "text-info-ink" : "text-text-4"}`}
                  >
                    {/* L11：搜索时给「命中 / 共 N」双口径，别让「剩 3 条」被读成「一共 3 条」。 */}
                    {query.trim() !== ""
                      ? `命中 ${filtered[key]?.length ?? 0} / 共 ${unfiltered[key]?.length ?? 0}`
                      : (filtered[key]?.length ?? 0)}
                  </span>
                </button>
                {key === "retry" && !!filtered.retry?.length && (
                  <>
                    <Button
                      variant="ghost"
                      size="mini"
                      className="shrink-0"
                      disabled={saving}
                      onClick={() => void removeRetry()}
                    >
                      清空名单
                    </Button>
                    <Tip label="冻结本轮名单发车：名单里的条目转入排队中并打「重打」标记">
                      <Button
                        variant="accent"
                        size="xs"
                        className="shrink-0"
                        disabled={saving}
                        onClick={() => setRetryRequest((value) => value + 1)}
                      >
                        {`开始重试（${filtered.retry?.length ?? 0}）`}
                      </Button>
                    </Tip>
                  </>
                )}
                {key === "missing" && !!filtered.missing?.length && (
                  <Tip label="把当前清单中可从来源找回的缺失素材重新导入">
                    <Button
                      variant="ghost"
                      size="xs"
                      className="shrink-0"
                      disabled={!filtered.missing.some((row) => row.recoverable)}
                      onClick={() =>
                        setRecovery({
                          names: (filtered.missing ?? [])
                            .filter((row) => row.recoverable)
                            .map((row) => row.name),
                          mode: "restore",
                        })
                      }
                    >
                      一键导入
                    </Button>
                  </Tip>
                )}
                {key === "unimported" && !!filtered.unimported?.length && (
                  <Tip label="导入当前清单中符合格式与大小限制的文件">
                    <Button
                      variant="ghost"
                      size="xs"
                      className="shrink-0"
                      disabled={
                        !filtered.unimported.some((row) => row.reason === "未登记")
                      }
                      onClick={() =>
                        setRecovery({
                          names: (filtered.unimported ?? [])
                            .filter((row) => row.reason === "未登记")
                            .map((row) => row.name),
                          mode: "inplace",
                        })
                      }
                    >
                      一键导入
                    </Button>
                  </Tip>
                )}
                {selectionMode && (key === "done" || key === "failed") && (
                  <button
                    type="button"
                    className="float-right text-t-xs"
                    disabled={saving}
                    aria-label={`${label}${
                      (filtered[key] ?? [])
                        .filter((row) => row.can_retry && !row.in_retry)
                        .every((row) => checked.has(row.item))
                        ? "清空本组"
                        : "全选"
                    }`}
                    onClick={(event) => {
                      event.preventDefault();
                      const eligible = (filtered[key] ?? []).filter(
                        (row) => row.can_retry && !row.in_retry,
                      );
                      const allChecked = eligible.every((row) => checked.has(row.item));
                      setChecked((previous) => {
                        const next = new Set(previous);
                        for (const row of eligible) {
                          if (allChecked) next.delete(row.item);
                          else next.add(row.item);
                        }
                        return next;
                      });
                    }}
                  >
                    {/* L10（PRD F7 口径）：同一颗钮随态换文案——点下去是反选，
                        文案就必须能预告结果；六种叫法收敛为「全选 / 清空本组」。 */}
                    {(filtered[key] ?? [])
                      .filter((row) => row.can_retry && !row.in_retry)
                      .every((row) => checked.has(row.item))
                      ? "清空本组"
                      : "全选"}
                  </button>
                )}
              </div>
              {(query || !collapsed.has(key)) && (
                <div className="p-2">
                  {(() => {
                    // V3（2026-09-21 审计 / PRD F6 不冲突）：全量渲染不虚拟化，
                    // 但组内默认只呈现 4 行 + 「其余 N 条」展开钮——几百条时
                    // 一屏滚不到头是呈现层问题，截断即可，不必上虚拟化。
                    const rows = filtered[key] ?? [];
                    const expanded = query.trim() !== "" || expandedGroups.has(key);
                    const shown = expanded ? rows : rows.slice(0, 4);
                    const rest = rows.length - shown.length;
                    return (
                      <>
                        {shown.map((row) => (
                          <MaterialRow
                            key={itemKey(row)}
                            row={row}
                            selected={selectedItem === itemKey(row)}
                            onSelect={choose}
                            selectionMode={selectionMode}
                            checked={checked.has(row.item)}
                            onCheck={toggleCheck}
                            retryGroup={key === "retry"}
                            saving={saving}
                            onRemoveRetry={removeRetry}
                            onRecover={recover}
                            onRemoveUnimported={requestRemoval}
                          />
                        ))}
                        {rest > 0 && (
                          <button
                            type="button"
                            className="w-full rounded-md px-2 py-2 text-left text-t-sm text-muted-foreground hover:bg-accent"
                            onClick={() =>
                              setExpandedGroups((previous) => {
                                const next = new Set(previous);
                                next.add(key);
                                return next;
                              })
                            }
                          >
                            … 其余 {rest} 条（点任意条目可预览）
                          </button>
                        )}
                        {expandedGroups.has(key) && rows.length > 4 && (
                          <button
                            type="button"
                            className="w-full rounded-md px-2 py-2 text-left text-t-sm text-muted-foreground hover:bg-accent"
                            onClick={() =>
                              setExpandedGroups((previous) => {
                                const next = new Set(previous);
                                next.delete(key);
                                return next;
                              })
                            }
                          >
                            收起
                          </button>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
            </section>
          ))}
      </div>
    </aside>
  );
}
