import { BookOpenIcon, ChevronDownIcon, ListChecksIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../api";
import type { components } from "../../../api-types.gen";
import { FormError } from "../../../components/form-error";
import {
  SquareCheckIcon,
  SquareFrameIcon,
  SquareMinusIcon,
} from "../../../components/icons";
import { Button } from "../../../components/ui/button";
import { Tip } from "../../../components/ui/tooltip";
import { SnapshotDialog } from "../batching/SnapshotDialog";
import { RebuildImportsDialog } from "../workdir/RebuildImportsDialog";
import { ExportPanel } from "./ExportPanel";
import type { ItemMap } from "./items-state";
import { JournalCorruptedLine } from "./journal-corrupted-line";
import { RunOverview } from "./RunOverview";
import { useIntegrityScan } from "./use-integrity-scan";

interface Props {
  wid: string;
  /** 工作目录真值路径（重建窗头右副题槽用）。 */
  workdirPath: string;
  batch: string;
  items: ItemMap;
  exportRevision?: number;
  /** 跑批进行中：导出入口收起，避免导出半批产物。 */
  running?: boolean;
  onSelect: (row: components["schemas"]["ItemRowView"]) => void;
  onImported?: () => void;
  /** 打包被排除清单的「重新指定」：目录选择弹窗住在页面层。 */
  onRepoint?: (name: string) => void;
  /** 打包清单「加入重试」成功后回灌左列名单。 */
  onRetryChanged?: (items: string[]) => void;
  /** 运行记录损坏的那一份（页面层取数报出；⑥ 损坏档在副行给就地出口）。 */
  journalRun?: string | null;
  /** 窄屏展收的展开钮（状态住在页面层；稿 §22＝概览视图挂大题行最左）。 */
  listToggle?: ReactNode;
}

/** 本件渲染的两组问题（④ 收窄：缺失／无法读取不进这个列表；后端四类保持不动）。 */
const integrityLabels = {
  changed: "打标后素材已变更",
  unknown: "无法校验",
} as const;

export function BatchOverview({
  wid,
  workdirPath,
  batch,
  items,
  exportRevision = 0,
  running = false,
  onSelect,
  onImported,
  onRepoint,
  onRetryChanged,
  journalRun,
  listToggle,
}: Props) {
  const [rebuildOpen, setRebuildOpen] = useState(false);
  // ⑩ 宿主联动：重建任务在后台跑时（弹窗已关），本件持有句柄轮询到终态并自动重扫，期间触发件禁用。
  const [rebuildTask, setRebuildTask] = useState<string | null>(null);
  const [snapshotIdentity, setSnapshotIdentity] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [excluding, setExcluding] = useState(false);
  const [exclusionError, setExclusionError] = useState("");
  const [exclusionRevision, setExclusionRevision] = useState(0);
  const [addingRetry, setAddingRetry] = useState(false);
  const mutationPending = useRef(false);
  const generation = useRef(0);
  // 换批次时命令域的随行复位：由 useIntegrityScan 的身份复位 effect 统一联动
  // （先于任何取数，次序同拆分前）；卸载时的代次失效由下方独立清理承担。
  const onIdentityReset = useCallback(() => {
    generation.current += 1;
    mutationPending.current = false;
    setSelecting(false);
    setSelected(new Set());
    setExcluding(false);
    setAddingRetry(false);
    setExclusionError("");
    setRebuildOpen(false);
  }, []);
  const { report, checking, error, scan } = useIntegrityScan(
    wid,
    batch,
    exportRevision,
    onIdentityReset,
  );
  // 卸载时使在途命令的代次护栏失效（身份变更路径的失效在 onIdentityReset 内）。
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );
  // 后台重建：弹窗关掉也盯到终态，完成即重扫＋回灌条目（句柄一到终态就清掉，不留禁用态）。
  useEffect(() => {
    if (!rebuildTask) return;
    const id = rebuildTask;
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function watch() {
      try {
        const view = await api.getTask(id);
        if (!current) return;
        if (view.status === "running") {
          timer = setTimeout(() => void watch(), 2000);
          return;
        }
        setRebuildTask(null);
        onImported?.();
        void scan();
      } catch {
        if (current) timer = setTimeout(() => void watch(), 2000);
      }
    }
    void watch();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [rebuildTask, scan, onImported]);

  const members = [...items.values()].filter((row) => row.status !== "unimported");
  const failed = members.filter((row) => row.status === "failed");
  const integrity = report?.batches.find((entry) => entry.batch === batch)?.items ?? [];
  const problems = integrity.filter((row) => row.status !== "valid");
  const changed = problems.filter((row) => row.status === "changed");
  const chosen = changed.filter((row) => selected.has(row.item)).map((row) => row.item);
  // ④ 问题组收窄为两组（缺失／无法读取不进本列表；后端四类保持不动）。顺序恒 changed → unknown。
  const shownGroups = (["changed", "unknown"] as const).map((status) => ({
    status,
    label: integrityLabels[status],
    rows: problems.filter((row) => row.status === status),
  }));
  const hashProblems = integrity.filter(
    (row) => row.status === "changed" || row.status === "unknown",
  );
  /**
   * 分区头副行（稿「素材完整性」⑥）：第一段＝「上次校验 〈时间〉」，第二段＝六档互斥的结论。
   *
   * 可点的两档（缺件／损坏）挂在触发钮**外面**——嵌套 <button> 会被 HTML 解析器拆出容器（#6 分组头实测），
   * 拆出去正好实现「整行可点、句与动作钮例外」；其余四档是纯文字，留在触发钮内随副行走。
   */
  const integrityHead: ReactNode = (
    <>
      {report && (
        <Tip label={`上次校验 ${new Date(report.checked_at).toLocaleString()}`}>
          <time
            className="min-w-0 shrink-0 truncate text-t-xs text-text-4 tabular-nums"
            dateTime={report.checked_at}
          >
            上次校验 {new Date(report.checked_at).toLocaleString()}
          </time>
        </Tip>
      )}
      {/* 第二段＝§25 .ovs2（flex:none／段间另给 --s-3／t-sm／nowrap），六档互斥各占一色；
          「正在校验…」是 .ovs2--busy，比结论段小一号（t-xs）。 */}
      {journalRun || (report && !report.imports_available) ? null : error ? (
        // 普通失败句才挂播报（带出口的处置句不挂——常驻状态不是一次性结果）。
        <span role="alert" className="ml-3 shrink-0 truncate text-t-sm text-bad-ink">
          {error}
        </span>
      ) : checking ? (
        <span className="ml-3 shrink-0 text-t-xs text-text-4">正在校验…</span>
      ) : !report ? (
        <span className="ml-3 shrink-0 text-t-sm text-muted-foreground">尚未校验</span>
      ) : hashProblems.length ? null : (
        <span className="ml-3 shrink-0 text-t-sm text-ok-ink">
          素材哈希全部一致 · {integrity.length} 条
        </span>
      )}
    </>
  );
  const integrityExit: ReactNode = journalRun ? (
    <JournalCorruptedLine
      className="shrink-0 self-center text-t-sm"
      wid={wid}
      run={journalRun}
      onCleaned={() => void scan()}
    />
  ) : report && !report.imports_available ? (
    <button
      type="button"
      className="shrink-0 self-center text-t-sm text-bad-ink underline hover:text-bad-ink-hover aria-disabled:no-underline aria-disabled:hover:text-bad-ink"
      aria-disabled={rebuildTask !== null || undefined}
      onClick={() => rebuildTask === null && setRebuildOpen(true)}
    >
      校验失败，缺失导入记录
    </button>
  ) : null;

  function toggleSelected(item: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(item)) next.delete(item);
      else next.add(item);
      return next;
    });
  }

  async function excludeChanged() {
    if (mutationPending.current || checking || !chosen.length) return;
    const version = generation.current;
    mutationPending.current = true;
    setExcluding(true);
    setExclusionError("");
    try {
      await api.setExclusions(wid, batch, chosen, true);
      if (version !== generation.current) return;
      setSelected(new Set());
      setSelecting(false);
      setExclusionRevision((value) => value + 1);
    } catch (reason) {
      if (version === generation.current) setExclusionError(errorMessage(reason));
    } finally {
      if (version === generation.current) {
        mutationPending.current = false;
        setExcluding(false);
      }
    }
  }

  /**
   * 加入重试名单：与左列同一套 `addRetryItems`（只写 `retry_list`、不起跑批）。
   *
   * 「重打」作为独立动作已撤（2026-10-08 用户裁「取消独立的重打逻辑，全都复用加入重试」）——
   * 因此本件不再发 `startRun`，409「已有跑批在运行」不再是本件的失败面；资格判定仍走后端
   * 同一份 `can_retry`（400「选中条目中存在不可重打的素材」会照原样回）。
   */
  async function addRetry(items: string[]) {
    if (mutationPending.current || checking || !items.length) return;
    const version = generation.current;
    mutationPending.current = true;
    setAddingRetry(true);
    setExclusionError("");
    try {
      const result = await api.addRetryItems(wid, batch, items);
      if (version !== generation.current) return;
      onRetryChanged?.(result.items);
      setSelected(new Set());
      setSelecting(false);
    } catch (reason) {
      if (version === generation.current) setExclusionError(errorMessage(reason));
    } finally {
      if (version === generation.current) {
        mutationPending.current = false;
        setAddingRetry(false);
      }
    }
  }

  /** 已入名单的行「移出重试」：同样只动名单，不触发本件校验（名单不是素材状态）。 */
  async function removeRetry(item: string) {
    if (mutationPending.current || checking) return;
    const version = generation.current;
    mutationPending.current = true;
    setAddingRetry(true);
    setExclusionError("");
    try {
      const result = await api.removeRetryItem(wid, batch, item);
      if (version !== generation.current) return;
      onRetryChanged?.(result.items);
    } catch (reason) {
      if (version === generation.current) setExclusionError(errorMessage(reason));
    } finally {
      if (version === generation.current) {
        mutationPending.current = false;
        setAddingRetry(false);
      }
    }
  }

  return (
    <section aria-label="批次概览" className="min-w-0 px-6 py-4">
      {rebuildOpen && (
        <RebuildImportsDialog
          key={wid}
          wid={wid}
          workdirPath={workdirPath}
          onClose={() => setRebuildOpen(false)}
          onRebuilt={() => {
            onImported?.();
            void scan();
          }}
          onBackground={(id) => {
            setRebuildOpen(false);
            setRebuildTask(id);
          }}
        />
      )}
      <div className="mb-3 flex items-center gap-3">
        {listToggle}
        <h2 className="text-t-xl font-medium">批次概览</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSnapshotIdentity(`${wid}/${batch}`)}
        >
          <BookOpenIcon />
          快照
        </Button>
      </div>
      {snapshotIdentity === `${wid}/${batch}` && (
        <SnapshotDialog
          key={snapshotIdentity}
          wid={wid}
          batch={batch}
          onClose={() => setSnapshotIdentity(null)}
        />
      )}
      <RunOverview
        wid={wid}
        batch={batch}
        refreshKey={items}
        fallback={{
          total: members.length,
          done: members.filter((row) => row.status === "done").length,
          failed: failed.length,
        }}
      />
      <section className="mt-4 border-t border-border pt-4" aria-label="素材完整性">
        {/* 分区头（稿「素材完整性」⑭⑮⑯）：整行可点的折叠触发区——真 <button> 吃满动作钮以前的
            全部宽度，内含 13px chevron＋题字＋副行；悬停墨底挂**行容器**（本分区不吸顶，直接用
            半透明 --accent，不做吸顶件那层铺白底）；右端「校验素材完整性」是真动作钮、留在钮外不
            参与折叠。行容器 baseline（混排行定案），钮内部 center、动作钮 align-self center。 */}
        <div className="flex items-baseline gap-3 rounded-md hover:bg-accent">
          <button
            type="button"
            className="flex h-(--h-md) min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            <ChevronDownIcon
              className={`size-(--icon-xs) shrink-0 text-text-3 ${expanded ? "" : "-rotate-90"}`}
            />
            <span className="shrink-0 text-t-md font-medium">素材完整性</span>
            {integrityHead}
          </button>
          {integrityExit}
          <Button
            variant="ghost"
            size="sm"
            aria-disabled={checking || undefined}
            className="aria-disabled:pointer-events-none mr-2 self-center shrink-0"
            onClick={() => void scan()}
          >
            校验素材完整性
          </Button>
        </div>
        {exclusionError && (
          // ⑥：错误行合并进副行、两行不并列——命令类失败（排除打包／加入重试被拒）同位播报。
          <FormError className="mb-3 mt-1 text-t-sm text-bad-ink">
            {exclusionError}
          </FormError>
        )}
        {expanded && report && (
          <div aria-busy={checking}>
            {shownGroups.map(({ status, label, rows }) => {
              if (!rows.length) return null;
              return (
                <section key={status} aria-label={label} className="mt-3">
                  <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
                    {/* ⑦ 行内零说明文字：unknown 那句成因是**组级共因**，改挂组题悬停 Tip（不加可点装饰）。 */}
                    {status === "unknown" ? (
                      <Tip label="没有成功打标时的素材哈希，无法判断产物时效">
                        <h4 className="text-t-sm font-medium">
                          {label}{" "}
                          <span className="text-text-4 tabular-nums">
                            {rows.length}
                          </span>
                        </h4>
                      </Tip>
                    ) : (
                      <h4 className="text-t-sm font-medium">
                        {label}{" "}
                        <span className="text-text-4 tabular-nums">{rows.length}</span>
                      </h4>
                    )}
                    {status === "changed" && (
                      <div className="ml-auto flex items-center gap-1 self-center">
                        {/* ⑧ 选择态四枚定序：排除打包(N)｜加入重试(N)｜全选三态图标｜选择·取消图标；
                            「已选 N」撤除（计数由前两枚自己的 (N) 承担），四枚同取 --sm（26px）与图标同高。 */}
                        {selecting && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={excluding || checking || !chosen.length}
                              onClick={() => void excludeChanged()}
                            >
                              {`排除打包(${chosen.length})`}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={
                                addingRetry ||
                                excluding ||
                                checking ||
                                !chosen.length ||
                                chosen.some((item) => !items.get(item)?.can_retry)
                              }
                              onClick={() => void addRetry(chosen)}
                            >
                              {`加入重试(${chosen.length})`}
                            </Button>
                            <Tip
                              label={
                                chosen.length === rows.length
                                  ? "取消全选"
                                  : chosen.length
                                    ? "全选（部分已选）"
                                    : "全选"
                              }
                            >
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={
                                  chosen.length === rows.length
                                    ? "取消全选"
                                    : chosen.length
                                      ? "全选（部分已选）"
                                      : "全选"
                                }
                                disabled={excluding || checking || addingRetry}
                                onClick={() =>
                                  setSelected(
                                    chosen.length === rows.length
                                      ? new Set()
                                      : new Set(rows.map((row) => row.item)),
                                  )
                                }
                              >
                                {chosen.length === rows.length ? (
                                  <SquareCheckIcon />
                                ) : chosen.length ? (
                                  <SquareMinusIcon />
                                ) : (
                                  <SquareFrameIcon />
                                )}
                              </Button>
                            </Tip>
                          </>
                        )}
                        <Tip label={selecting ? "取消选择" : "选择"}>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={selecting ? "取消选择" : "选择"}
                            disabled={excluding || checking}
                            onClick={() => {
                              setSelecting(!selecting);
                              setSelected(new Set());
                            }}
                          >
                            {selecting ? <XIcon /> : <ListChecksIcon />}
                          </Button>
                        </Tip>
                      </div>
                    )}
                  </div>
                  {rows.map((row) => {
                    const item = items.get(row.item);
                    // ⑪ 已重试＝该条已进跑批队列：整行压 --n-400、右端只留「已重试」，动作全撤（含「查看」）。
                    if (item?.status === "queued") {
                      return (
                        <div
                          key={row.name}
                          className="flex min-w-0 items-center gap-3 border-b border-border/60 py-2 text-t-sm text-n-400"
                        >
                          <span className="min-w-0 flex-1 break-all">{row.name}</span>
                          <span className="shrink-0 text-t-sm">已重试</span>
                        </div>
                      );
                    }
                    return (
                      <div
                        key={row.name}
                        className="flex min-w-0 items-center gap-3 border-b border-border/60 py-2 text-t-sm"
                      >
                        {status === "changed" && selecting && (
                          <input
                            type="checkbox"
                            className="cb"
                            aria-label={`选择变更素材 ${row.name}`}
                            checked={selected.has(row.item)}
                            disabled={excluding || checking || addingRetry}
                            onChange={() => toggleSelected(row.item)}
                          />
                        )}
                        <span className="min-w-0 flex-1 break-all">{row.name}</span>
                        {item && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onSelect(item)}
                          >
                            查看
                          </Button>
                        )}
                        {/* ⑨⑩ 本件不发跑批：动作＝与左列同一套「加入重试」；已入名单换「移出重试」
                            文字钮（叉号留在左列——本件的叉号没有指代对象），反馈交给左列自动展开那组。 */}
                        {item?.in_retry ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={checking || addingRetry}
                            onClick={() => void removeRetry(row.item)}
                          >
                            移出重试
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={checking || addingRetry || !item?.can_retry}
                            onClick={() => void addRetry([row.item])}
                          >
                            加入重试
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </section>
              );
            })}
          </div>
        )}
      </section>
      {running ? (
        // 导出只属于「已完成批次」——
        // 跑批中给入口等于邀请用户导出半批产物。
        <p className="mt-4 border-t border-border pt-4 text-t-sm text-text-4">
          跑批进行中——打包导出在本批完成后开放。
        </p>
      ) : (
        <ExportPanel
          wid={wid}
          batch={batch}
          refreshKey={`${exportRevision}/${exclusionRevision}`}
          onRepoint={onRepoint}
          onRetryChanged={onRetryChanged}
          mediaSummary={{
            images: members.filter((row) => row.media === "image").length,
            videos: members.filter((row) => row.media === "video").length,
          }}
        />
      )}
    </section>
  );
}
