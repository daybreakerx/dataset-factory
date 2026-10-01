import { BookOpenIcon, ChevronDownIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../api";
import type { components } from "../../../api-types.gen";
import { DialogShell } from "../../../components/dialog-shell";
import { FormError } from "../../../components/form-error";
import { Button } from "../../../components/ui/button";
import { SnapshotDialog } from "../batching/SnapshotDialog";
import { RebuildImportsDialog } from "../workdir/RebuildImportsDialog";
import { ExportPanel } from "./ExportPanel";
import type { ItemMap } from "./items-state";
import { LiveOutput } from "./live-output";
import { RunOverview } from "./RunOverview";
import { useIntegrityScan } from "./use-integrity-scan";

interface Props {
  wid: string;
  batch: string;
  items: ItemMap;
  exportRevision?: number;
  /** 跑批进行中（V15）：导出入口收起，避免导出半批产物（PRD F8 口径）。 */
  running?: boolean;
  /** 跑批中的「当前产出」逐字流（A2）；null = 没有正在产出的条目。 */
  liveOutput?: { item: string; reasoning: string; content: string } | null;
  onSelect: (row: components["schemas"]["ItemRowView"]) => void;
  onImported?: () => void;
  onImport?: () => void;
  onRunStarted?: (id: string) => void;
}

const integrityLabels = {
  changed: "打标后素材已变更",
  unknown: "无法校验",
  missing: "缺失",
  unreadable: "无法读取",
} as const;

export function BatchOverview({
  wid,
  batch,
  items,
  exportRevision = 0,
  running = false,
  liveOutput = null,
  onSelect,
  onImported,
  onImport,
  onRunStarted,
}: Props) {
  const [rebuildOpen, setRebuildOpen] = useState(false);
  const [snapshotIdentity, setSnapshotIdentity] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [excluding, setExcluding] = useState(false);
  const [exclusionError, setExclusionError] = useState("");
  const [exclusionRevision, setExclusionRevision] = useState(0);
  const [redo, setRedo] = useState<string[] | null>(null);
  const [redoing, setRedoing] = useState(false);
  const [redoError, setRedoError] = useState("");
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
    setExclusionError("");
    setRedo(null);
    setRedoing(false);
    setRedoError("");
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

  const members = [...items.values()].filter((row) => row.status !== "unimported");
  const failed = members.filter((row) => row.status === "failed");
  const integrity = report?.batches.find((entry) => entry.batch === batch)?.items ?? [];
  const problems = integrity.filter((row) => row.status !== "valid");
  const changed = problems.filter((row) => row.status === "changed");
  const chosen = changed.filter((row) => selected.has(row.item)).map((row) => row.item);

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

  async function startRedo() {
    if (mutationPending.current || !redo?.length) return;
    const version = generation.current;
    mutationPending.current = true;
    setRedoing(true);
    setRedoError("");
    try {
      const result = await api.startRun(wid, batch, "retry", redo);
      if (version !== generation.current) return;
      if (!result?.run_id) throw new Error("运行编号无效");
      setRedo(null);
      setSelected(new Set());
      setSelecting(false);
      onRunStarted?.(result.run_id);
      onImported?.();
    } catch (reason) {
      if (version === generation.current) setRedoError(errorMessage(reason));
    } finally {
      if (version === generation.current) {
        mutationPending.current = false;
        setRedoing(false);
      }
    }
  }

  return (
    <section aria-label="批次概览" className="min-w-0 px-6 py-4">
      {redo && (
        <DialogShell
          open
          onOpenChange={(open) => {
            if (!open && !redoing) setRedo(null);
          }}
          title={<>重打选中的 {redo.length} 条</>}
          description="用当前素材重新打标，覆盖现有的 txt。"
          cancel={{
            label: "取消",
            variant: "ghost",
            disabled: redoing,
            onClick: () => setRedo(null),
          }}
          confirm={{
            label: redoing ? "正在启动" : `重打这 ${redo.length} 条`,
            variant: "default",
            disabled: redoing,
            onClick: () => void startRedo(),
          }}
        >
          <ul className="max-h-64 overflow-auto text-t-sm">
            {redo.map((item) => (
              <li key={item} className="break-all py-1">
                {items.get(item)?.name ?? item}
              </li>
            ))}
          </ul>
          {redoError && (
            <FormError className="text-t-sm text-bad-ink">{redoError}</FormError>
          )}
        </DialogShell>
      )}
      {rebuildOpen && (
        <RebuildImportsDialog
          key={wid}
          wid={wid}
          onClose={() => setRebuildOpen(false)}
          onRebuilt={() => {
            onImported?.();
            void scan();
          }}
        />
      )}
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-t-xl font-medium">批次概览</h2>
        <Button
          variant="ghost"
          size="mini"
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
      {running && liveOutput !== null && (
        // A2（2026-09-21 审计定案）：跑批中的「当前产出」——逐字正文 + 思考折叠区。
        // 思考只展示不落盘：这里的内容全部来自 SSE 内存态，关掉页面再打开就没有。
        <LiveOutput wid={wid} liveOutput={liveOutput} />
      )}
      <section className="mt-4 border-t border-border pt-4" aria-label="素材完整性">
        <div className="mb-3 flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="xs"
            aria-label="折叠或展开校验清单"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            <ChevronDownIcon className={expanded ? "" : "-rotate-90"} />
          </Button>
          <h3 className="text-t-md font-medium">素材完整性</h3>
          {report && (
            <time
              className="min-w-0 truncate text-t-xs text-text-4"
              dateTime={report.checked_at}
            >
              上次校验 {new Date(report.checked_at).toLocaleString()}
            </time>
          )}
          <Button
            className="ml-auto"
            variant="ghost"
            size="mini"
            disabled={checking}
            onClick={() => void scan()}
          >
            {checking ? "正在校验" : "校验素材完整性"}
          </Button>
        </div>
        {error && (
          <FormError className="mb-3 text-t-sm text-bad-ink">{error}</FormError>
        )}
        {exclusionError && (
          <FormError className="mb-3 text-t-sm text-bad-ink">
            {exclusionError}
          </FormError>
        )}
        {expanded && report && (
          <div aria-busy={checking}>
            {(!report.imports_available ||
              problems.some((row) => row.status === "unknown")) && (
              <Button variant="ghost" size="mini" onClick={() => setRebuildOpen(true)}>
                重建导入记录
              </Button>
            )}
            {!report.imports_available && (
              <p className="text-t-sm text-warn-ink">
                缺少导入记录，无法完成缺失对账。
              </p>
            )}
            {!problems.length && report.imports_available && (
              <p className="text-t-sm text-ok-ink">校验通过 · {integrity.length} 条</p>
            )}
            {Object.entries(integrityLabels).map(([status, label]) => {
              const rows = problems.filter((row) => row.status === status);
              if (!rows.length) return null;
              return (
                <section key={status} aria-label={label} className="mt-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h4 className="text-t-sm font-medium">
                      {label}{" "}
                      <span className="text-text-4 tabular-nums">{rows.length}</span>
                    </h4>
                    {status === "changed" && (
                      <div className="ml-auto flex items-center gap-2">
                        {selecting && (
                          <>
                            <span className="text-t-xs text-text-4 tabular-nums">
                              已选 {chosen.length}
                            </span>
                            <Button
                              variant="ghost"
                              size="xs"
                              disabled={excluding || checking}
                              onClick={() =>
                                setSelected(
                                  new Set(
                                    chosen.length === changed.length
                                      ? []
                                      : changed.map((row) => row.item),
                                  ),
                                )
                              }
                            >
                              {chosen.length === changed.length ? "取消全选" : "全选"}
                            </Button>
                            <Button
                              variant="ghost"
                              size="xs"
                              disabled={excluding || checking || !chosen.length}
                              onClick={() => void excludeChanged()}
                            >
                              排除打包（{chosen.length}）
                            </Button>
                            <Button
                              variant="ghost"
                              size="xs"
                              disabled={
                                excluding ||
                                checking ||
                                !chosen.length ||
                                chosen.some((item) => !items.get(item)?.can_retry)
                              }
                              onClick={() => {
                                setRedoError("");
                                setRedo(chosen);
                              }}
                            >
                              重打（{chosen.length}）
                            </Button>
                          </>
                        )}
                        <Button
                          variant="ghost"
                          size="xs"
                          disabled={excluding || checking}
                          onClick={() => {
                            setSelecting(!selecting);
                            setSelected(new Set());
                          }}
                        >
                          {selecting ? "取消" : "选择"}
                        </Button>
                      </div>
                    )}
                  </div>
                  {rows.map((row) => (
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
                          disabled={excluding || checking}
                          onChange={(event) => {
                            const checked = event.currentTarget.checked;
                            setSelected((previous) => {
                              const next = new Set(previous);
                              if (checked) next.add(row.item);
                              else next.delete(row.item);
                              return next;
                            });
                          }}
                        />
                      )}
                      <span className="min-w-0 flex-1 break-all">{row.name}</span>
                      <span className="min-w-0 flex-1 text-text-3">{row.detail}</span>
                      {items.has(row.item) && (
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => {
                            const item = items.get(row.item);
                            if (item) onSelect(item);
                          }}
                        >
                          查看
                        </Button>
                      )}
                      {status === "changed" && (
                        <Button
                          variant="ghost"
                          size="mini"
                          disabled={
                            excluding || checking || !items.get(row.item)?.can_retry
                          }
                          onClick={() => {
                            setRedoError("");
                            setRedo([row.item]);
                          }}
                        >
                          重打
                        </Button>
                      )}
                    </div>
                  ))}
                </section>
              );
            })}
          </div>
        )}
      </section>
      {running ? (
        // V15（2026-09-21 审计 / PRD F8）：导出只属于「已完成批次」——
        // 跑批中给入口等于邀请用户导出半批产物。
        <p className="mt-4 border-t border-border pt-4 text-t-sm text-text-4">
          跑批进行中——打包导出在本批完成后开放。
        </p>
      ) : (
        <ExportPanel
          wid={wid}
          batch={batch}
          refreshKey={`${exportRevision}/${exclusionRevision}`}
          onImport={onImport}
          mediaSummary={{
            images: members.filter((row) => row.media === "image").length,
            videos: members.filter((row) => row.media === "video").length,
            changed: changed.length,
          }}
        />
      )}
      {!!failed.length && (
        <section className="mt-4 border-t border-border pt-4" aria-label="未完成清单">
          <h3 className="mb-3 text-t-md font-medium">
            未完成 <span className="text-bad-ink tabular-nums">{failed.length}</span>
          </h3>
          {failed.map((row) => (
            <button
              key={row.item}
              type="button"
              onClick={() => onSelect(row)}
              className="flex w-full min-w-0 gap-3 rounded-md px-2 py-2 text-left text-t-sm hover:bg-accent"
            >
              <span className="min-w-0 flex-1 break-all">{row.name}</span>
              <span className="min-w-0 flex-1 text-bad-ink">
                {row.message || row.reason}
              </span>
            </button>
          ))}
        </section>
      )}
    </section>
  );
}
