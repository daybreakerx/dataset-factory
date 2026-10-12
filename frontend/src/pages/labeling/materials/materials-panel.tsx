import {
  ArrowLeftIcon,
  ChevronDownIcon,
  ListChecksIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import type { Dispatch, ReactNode, RefObject, SetStateAction } from "react";
import { useMemo } from "react";
import {
  SquareCheckIcon,
  SquareFrameIcon,
  SquareMinusIcon,
} from "../../../components/icons";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Tip } from "../../../components/ui/tooltip";
import { usePersistedState } from "../../../hooks/use-persisted-state";
import { cn } from "../../../lib/utils";
import type { BatchSelection } from "../batching/BatchSelector";
import {
  groupedItems,
  ITEM_GROUPS,
  type ItemMap,
  type ItemRow,
  selectionKey,
} from "../runs/items-state";
import { MaterialRow } from "./material-row";

/** 六组的色档（§10 group-head 语义变体：颜色只落左 3px 竖条与计数）——重试＝琥珀，缺失／未导入灰分两阶。 */
const GROUP_TONE: Record<string, { bar: string; count: string }> = {
  queued: { bar: "border-l-primary", count: "text-primary" },
  done: { bar: "border-l-ok-ink", count: "text-ok-ink" },
  failed: { bar: "border-l-bad-ink", count: "text-bad-ink" },
  retry: { bar: "border-l-warn-ink", count: "text-warn-ink" },
  missing: { bar: "border-l-n-500", count: "text-n-500" },
  unimported: { bar: "border-l-n-400", count: "text-n-400" },
};

/** 本组可加入重试名单的行（选择态与三态判定的基数，随当前过滤收窄）。 */
function eligibleRows(rows: ItemRow[]): ItemRow[] {
  return rows.filter((row) => row.can_retry && !row.in_retry);
}

/** 素材条目左列：条目头＋搜索＋分组列表。筛选词 / 折叠 / 组内展开为本块私有持久化态。 */
export function MaterialsPanel({
  items,
  selection,
  loading,
  loadError,
  saving,
  selectionMode,
  setSelectionMode,
  checked,
  setChecked,
  toggleCheck,
  addSelected,
  removeRetry,
  setRetryRequest,
  selectedItem,
  choose,
  recover,
  repoint,
  requestRemoval,
  narrow,
  peek,
  backRef,
  onPeekBack,
  onPeekLeave,
}: {
  items: ItemMap;
  selection: BatchSelection | null;
  loading: boolean;
  /** 条目读取失败的固定句（列表槽内一行；操作级失败仍走页面错误条）。 */
  loadError: string;
  saving: boolean;
  selectionMode: boolean;
  setSelectionMode: Dispatch<SetStateAction<boolean>>;
  checked: ReadonlySet<string>;
  setChecked: Dispatch<SetStateAction<ReadonlySet<string>>>;
  toggleCheck: (item: string) => void;
  addSelected: () => Promise<void>;
  removeRetry: (item?: string) => Promise<void>;
  setRetryRequest: Dispatch<SetStateAction<number>>;
  /** 选中位＝「触发源组＋条目」复合键（⑫）：同一条目在重试列表与原分组各占一行，只亮点的那一行。 */
  selectedItem: string | null;
  choose: (row: ItemRow, group: string) => void;
  /** 行内「导入」／「重新导入」：点击直接执行，不经弹窗（2026-10-10 用户裁）。 */
  recover: (row: ItemRow) => void;
  /** 缺失行「重新指定」：来源已失效，开目录选择弹窗选定新来源。 */
  repoint: (name: string) => void;
  requestRemoval: (row: ItemRow) => void;
  /** 窄屏展收（hook＝usePeekList，稿 §22）：收起＝整列不出现，暂展＝作浮出层叠在画布上。 */
  narrow: boolean;
  peek: boolean;
  backRef: RefObject<HTMLButtonElement | null>;
  onPeekBack: () => void;
  onPeekLeave: () => void;
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
  const searching = query.trim() !== "";
  // 全局全选判定基数＝当前可见的可加入行（与组级同口径，稿「搜索中的全选范围」）。
  const visibleEligible = useMemo(
    () =>
      ITEM_GROUPS.flatMap(([key]) =>
        key === "done" || key === "failed"
          ? eligibleRows(filtered[key] ?? [])
          : ([] as ItemRow[]),
      ),
    [filtered],
  );
  const selectedEligible = visibleEligible.filter((row) =>
    checked.has(row.item),
  ).length;

  function toggleCheckAll() {
    setChecked((previous) => {
      const next = new Set(previous);
      const clear = selectedEligible === visibleEligible.length;
      for (const row of visibleEligible) {
        if (clear) next.delete(row.item);
        else next.add(row.item);
      }
      return next;
    });
  }

  function toggleGroupCheckAll(key: string) {
    const eligible = eligibleRows(filtered[key] ?? []);
    setChecked((previous) => {
      const next = new Set(previous);
      const clear = eligible.every((row) => previous.has(row.item));
      for (const row of eligible) {
        if (clear) next.delete(row.item);
        else next.add(row.item);
      }
      return next;
    });
  }

  const allChecked =
    visibleEligible.length > 0 && selectedEligible === visibleEligible.length;
  const halfChecked = selectedEligible > 0 && !allChecked;
  const selectAllLabel = allChecked
    ? "清除全部选择"
    : halfChecked
      ? "全选（部分已选）"
      : "全选";

  return (
    <aside
      id="lb-itemcol"
      onMouseLeave={peek ? onPeekLeave : undefined}
      className={cn(
        "flex min-h-0 w-(--w-col-left) shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card",
        // 窄屏收起＝整列不占位；暂展＝浮出层叠在画布上（画布不位移）：左缘对齐内容栏、
        // 右缘随容器内距收进，宽度取 min(320, 容器宽−两侧内距)，浮层影 --sh-3（稿 §22）。
        narrow && !peek && "hidden",
        narrow &&
          peek &&
          "absolute top-0 bottom-6 left-4 z-10 w-[min(var(--w-col-left),calc(100%-32px))] shadow-(--sh-3)",
      )}
      aria-label="素材条目"
    >
      {/* 头行＝§34 .lb-colhead：基线对齐（13px 题字与 12px 钮文字同基线）、左内距 16 与搜索框／组头同缘线。 */}
      <div
        className={
          peek
            ? "flex min-h-10 flex-wrap items-baseline gap-2 pt-4 pr-3"
            : "flex min-h-10 flex-wrap items-baseline gap-2 px-4 pt-4 pb-2"
        }
      >
        {peek && (
          <Tip label="收起列表">
            <Button
              ref={backRef}
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="收起列表"
              onClick={onPeekBack}
            >
              <ArrowLeftIcon />
            </Button>
          </Tip>
        )}
        <span className="mr-auto text-t-md font-medium">条目</span>
        {selectionMode ? (
          // 多选态动作簇右聚相连（稿「加入重试(N)｜全选｜退出选择」）；空集那两枚不出现（禁用＝不出）。
          <>
            {visibleEligible.length > 0 && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={saving || selectedEligible === 0}
                  onClick={() => void addSelected()}
                >
                  {`加入重试(${checked.size})`}
                </Button>
                <Tip label={selectAllLabel}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={selectAllLabel}
                    onClick={toggleCheckAll}
                  >
                    {allChecked ? (
                      <SquareCheckIcon />
                    ) : halfChecked ? (
                      <SquareMinusIcon />
                    ) : (
                      <SquareFrameIcon />
                    )}
                  </Button>
                </Tip>
              </>
            )}
            <Tip label="退出选择">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="退出选择"
                onClick={() => {
                  setSelectionMode(false);
                  setChecked(new Set());
                }}
              >
                <XIcon />
              </Button>
            </Tip>
          </>
        ) : (
          <Tip label="选择">
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={saving || !selection || loading}
              aria-label="选择"
              onClick={() => {
                setSelectionMode(true);
                setChecked(new Set());
              }}
            >
              <ListChecksIcon />
            </Button>
          </Tip>
        )}
      </div>
      {/* 搜索框＝§8 .search 族（34px 高版、图标 16 绝对定位、左内距 32；聚焦描边随 .input 档） */}
      <div className="relative mr-3 mb-2 ml-4">
        <SearchIcon className="absolute top-1/2 left-3 size-(--icon-md) -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="搜索条目"
          placeholder="搜索条目"
          className="pl-8"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto" aria-busy={loading}>
        {loading && <p className="p-3 text-t-sm text-muted-foreground">正在读取…</p>}
        {!loading && loadError && (
          <p role="alert" className="p-3 text-t-sm text-bad-ink">
            条目读取失败
          </p>
        )}
        {!loading && !loadError && !selection && (
          <p className="px-4 py-3 text-t-sm text-muted-foreground">还没有可用批次</p>
        )}
        {/* 搜索无匹配＝列表槽里一行短句，不给六组 0 计（稿「列表三态」）。 */}
        {!loading &&
          !loadError &&
          selection &&
          searching &&
          visibleRows(filtered).length === 0 && (
            <p className="px-4 py-3 text-t-sm text-muted-foreground">没有匹配的条目</p>
          )}
        {!loading &&
          !loadError &&
          selection &&
          ITEM_GROUPS.map(([key, label]) => {
            const rows = filtered[key] ?? [];
            const tone = GROUP_TONE[key];
            if (tone === undefined) return null;
            const groupEligible =
              key === "done" || key === "failed" ? eligibleRows(rows) : [];
            const groupChecked = groupEligible.filter((row) =>
              checked.has(row.item),
            ).length;
            const groupAll =
              groupEligible.length > 0 && groupChecked === groupEligible.length;
            const groupHalf = groupChecked > 0 && !groupAll;
            const groupLabel = groupAll
              ? "清除本组选择"
              : groupHalf
                ? "全选本组（部分已选）"
                : "全选本组";
            return (
              <section key={key} aria-label={label}>
                <div
                  className={`sticky top-0 z-10 flex h-(--h-lg) w-full items-center gap-2 border-b border-border/60 border-l-[3px] bg-card px-4 text-t-md font-medium text-text-1 hover:bg-[linear-gradient(hsl(var(--accent)),hsl(var(--accent)))] ${tone.bar}`}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    aria-expanded={!searching && !collapsed.has(key)}
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
                      className={`size-(--icon-sm) shrink-0 text-text-3 ${!searching && collapsed.has(key) ? "-rotate-90" : ""}`}
                    />
                    {label}
                    {/* 计数＝纯数字读数（N/M 双值承担「命中／共」，防「剩 3 条」被读成「一共 3 条」）。 */}
                    <span
                      className={`text-t-xs font-medium tabular-nums ${tone.count}`}
                    >
                      {searching
                        ? `${rows.length}/${unfiltered[key]?.length ?? 0}`
                        : rows.length}
                    </span>
                  </button>
                  {key === "retry" && !!rows.length && (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={saving}
                        onClick={() => void removeRetry()}
                      >
                        清空名单
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={saving}
                        onClick={() => setRetryRequest((value) => value + 1)}
                      >
                        {`开始重试(${rows.length})`}
                      </Button>
                    </div>
                  )}
                  {selectionMode && groupEligible.length > 0 && (
                    <Tip label={groupLabel}>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={groupLabel}
                        onClick={() => toggleGroupCheckAll(key)}
                      >
                        {groupAll ? (
                          <SquareCheckIcon />
                        ) : groupHalf ? (
                          <SquareMinusIcon />
                        ) : (
                          <SquareFrameIcon />
                        )}
                      </Button>
                    </Tip>
                  )}
                </div>
                {(searching || !collapsed.has(key)) && (
                  <div className="p-2">
                    <GroupBody
                      rows={rows}
                      collapsedKey={key}
                      searching={searching}
                      expandedGroups={expandedGroups}
                      setExpandedGroups={setExpandedGroups}
                      selectionMode={selectionMode}
                      checked={checked}
                      toggleCheck={toggleCheck}
                      saving={saving}
                      selectedItem={selectedItem}
                      choose={(row) => {
                        choose(row, key);
                        // 点行即收（稿「暂展」出口）：选中并切换画布，浮出层收起、不夺焦点。
                        if (narrow && peek) onPeekLeave();
                      }}
                      recover={recover}
                      repoint={repoint}
                      requestRemoval={requestRemoval}
                      removeRetry={removeRetry}
                    />
                  </div>
                )}
              </section>
            );
          })}
      </div>
    </aside>
  );
}

/** 一个组的行体：默认截断 4 行＋「其余 N 条」展开钮（几百条时截断即可，不上虚拟化）。 */
function GroupBody({
  rows,
  collapsedKey,
  searching,
  expandedGroups,
  setExpandedGroups,
  selectionMode,
  checked,
  toggleCheck,
  saving,
  selectedItem,
  choose,
  recover,
  repoint,
  requestRemoval,
  removeRetry,
}: {
  rows: ItemRow[];
  collapsedKey: string;
  searching: boolean;
  expandedGroups: ReadonlySet<string>;
  setExpandedGroups: Dispatch<SetStateAction<ReadonlySet<string>>>;
  selectionMode: boolean;
  checked: ReadonlySet<string>;
  toggleCheck: (item: string) => void;
  saving: boolean;
  selectedItem: string | null;
  choose: (row: ItemRow) => void;
  recover: (row: ItemRow) => void;
  repoint: (name: string) => void;
  requestRemoval: (row: ItemRow) => void;
  removeRetry: (item?: string) => Promise<void>;
}): ReactNode {
  const expanded = searching || expandedGroups.has(collapsedKey);
  const shown = expanded ? rows : rows.slice(0, 4);
  const rest = rows.length - shown.length;
  return (
    <>
      {shown.map((row) => (
        <MaterialRow
          key={selectionKey(collapsedKey, row)}
          row={row}
          selected={selectedItem === selectionKey(collapsedKey, row)}
          onSelect={choose}
          selectionMode={selectionMode}
          checked={checked.has(row.item)}
          onCheck={toggleCheck}
          retryGroup={collapsedKey === "retry"}
          saving={saving}
          onRemoveRetry={(item) => void removeRetry(item)}
          onRecover={recover}
          onRepoint={repoint}
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
              next.add(collapsedKey);
              return next;
            })
          }
        >
          … 其余 {rest} 条（点任意条目可预览）
        </button>
      )}
      {expandedGroups.has(collapsedKey) && rows.length > 4 && (
        <button
          type="button"
          className="w-full rounded-md px-2 py-2 text-left text-t-sm text-muted-foreground hover:bg-accent"
          onClick={() =>
            setExpandedGroups((previous) => {
              const next = new Set(previous);
              next.delete(collapsedKey);
              return next;
            })
          }
        >
          收起
        </button>
      )}
    </>
  );
}

/** 过滤后仍有行的组名清单——用来判「搜索无匹配」（那种场合不给六组 0 计）。 */
function visibleRows(groups: Record<string, ItemRow[]>): ItemRow[] {
  return ITEM_GROUPS.flatMap(([key]) => groups[key] ?? []);
}
