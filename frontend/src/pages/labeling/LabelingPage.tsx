import { FileImageIcon, PanelLeftOpenIcon, PlusIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, corruptedRunOf, errorMessage } from "../../api";
import type { components } from "../../api-types.gen";
import { DirectoryPicker } from "../../components/DirectoryPicker";
import { FormError } from "../../components/form-error";
import { Button } from "../../components/ui/button";
import { Tip } from "../../components/ui/tooltip";
import { usePeekList } from "../../hooks/use-peek-list";
import { reportError } from "../../lib/feedback";
import { toast } from "../../lib/toast";
import {
  LABELING_SELECTED_ITEM_KEY,
  readStoredString,
  writeStoredJson,
} from "../../lib/ui-storage";
import { BatchConfiguration } from "./batching/BatchConfiguration";
import { BatchSelector } from "./batching/BatchSelector";
import { NewBatchForm } from "./batching/NewBatchForm";
import { NewStrategyDialog } from "./batching/NewStrategyDialog";
import { RepointStrategyDialog } from "./batching/RepointStrategyDialog";
import { useBatchRunState } from "./hooks/use-batch-run-state";
import { loadWorkdirBatches, useWorkdirBatches } from "./hooks/use-workdir-batches";
import {
  importFromDirectory,
  registerInPlace,
  reimportFromSource,
} from "./material-actions";
import { MaterialDetail } from "./materials/material-detail";
import { MaterialsPanel } from "./materials/materials-panel";
import { BatchOverview } from "./runs/BatchOverview";
import {
  type ItemMap,
  type ItemRow,
  itemKeyFromSelection,
  itemsFromGroups,
  selectionKey,
  withInflightOverride,
  withItemUpdate,
  withRetryItems,
} from "./runs/items-state";
import { RunControl } from "./runs/RunControl";
import { RemoveUnimportedDialog } from "./workdir/RemoveUnimportedDialog";
import { WorkdirSettings } from "./workdir/WorkdirSettings";

/** 目录与批次切换以成对身份取数，过期请求不能覆盖新选择。 */
export function LabelingPage({
  onNavigateToSettings,
  onOpenWorkbench,
}: {
  /** 跳应用级设置页（新建批次的三个下拉要有「去设置」的出口）。 */
  onNavigateToSettings?: () => void;
  /** 跳对话工作台（「拿不准效果？先试标」动线）。 */
  onOpenWorkbench?: () => void;
} = {}) {
  const [error, setError] = useState("");
  // 条目取数失败固定句（列表槽一行）；操作级失败仍走上面的页面错误条——两条分道随「分组头」⑨。
  const [itemsError, setItemsError] = useState("");
  // 窄屏列表展收（稿 §22，与设置页同构；hook 已上移共享）。
  const { narrow, peek, toggleRef, backRef, openPeek, closePeek } = usePeekList();
  // 后端叫得出「是哪一份运行记录坏了」时，A／D 两面的错误行换成可点红字（ADR 2026-10-09）。
  const [errorRun, setErrorRun] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const {
    workdirs,
    setWorkdirs,
    selection,
    setSelection,
    setDirectoriesRevision,
    flight,
    loadError,
  } = useWorkdirBatches({ setLoading });
  const [items, setItems] = useState<ItemMap>(new Map());
  const [exportRevision, setExportRevision] = useState(0);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  // 选中素材跨重启恢复：只在启动后的首次装载生效一次，换批次 / 换条目的
  // 既有清空语义不变。素材 id 批次内有效，恢复时对装载结果校验，对不上就放弃。
  const restoredItemRef = useRef<string | null>(
    readStoredString(LABELING_SELECTED_ITEM_KEY),
  );
  const followRun = useRef(true);
  const [foldedItem, setFoldedItem] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [retryRequest, setRetryRequest] = useState(0);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [removal, setRemoval] = useState<{ identity: string; name: string } | null>(
    null,
  );
  // 「重新指定」待顶替的缺失文件名（开目录选择弹窗时记下，选定即按新来源直接导入）。
  const [repoint, setRepoint] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [settingsWid, setSettingsWid] = useState<string | null>(null);
  const [newStrategyWid, setNewStrategyWid] = useState<string | null>(null);
  // 「重新指定」弹窗（2026-10-13 E4）：新增策略弹窗的引用缺失行点出来的修复出口
  // （与素材域的 repoint 是两回事——那个选文件，这个改策略引用）。
  const [repointStrategy, setRepointStrategy] = useState<
    components["schemas"]["StrategyView"] | null
  >(null);
  // 「重新指定」成功后的重拉信号：驱动新建批次表单重拉四表（坏行当场回 healthy）。
  const [listsRevision, setListsRevision] = useState(0);
  // 跑批中点条目会停跟随——给可见提示 + 「继续跟随」钮，不再静默停。
  const [followPaused, setFollowPaused] = useState(false);
  // 跑批中的「当前产出」逐字呈现（思考只展示不落盘，关掉页面即没）。
  // stopped＝中断停因（E5，产出区稿矩阵⑨）：user＝手动停止（琥珀）／network＝SSE
  // 断流（红）；半截内容只活内存，刷新/切页/换条目即丢（后端本就不落半截）。
  const [liveOutput, setLiveOutput] = useState<{
    item: string;
    reasoning: string;
    content: string;
    stopped?: "user" | "network" | null;
  } | null>(null);
  // liveOutput 的 ref 镜像：终态事件与 setLiveOutput 在同一事件循环里先后到达
  // （run-finished → onRunStatus → finish → onCurrentItem(null)），state 还没落盘，
  // 收起跟随的判断必须读 ref（与 followRun 同模式）。
  const liveOutputRef = useRef(liveOutput);
  const applyLiveOutput = useCallback((next: typeof liveOutput) => {
    liveOutputRef.current = next;
    setLiveOutput(next);
  }, []);
  const identity = `${selection?.workdirId}/${selection?.batchId}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const mounted = useRef(false);
  const refreshVersion = useRef(0);
  // T14：这一场在飞的条目名单（发车时按清单快照冻结）＋ items 的 ref 镜像
  // （发车上报与 setState 在同一事件循环里先后到达，读 ref 取最新清单）。
  const [inflight, setInflight] = useState<ReadonlySet<string>>(new Set());
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const selectedKey = selectedItem === null ? null : itemKeyFromSelection(selectedItem);
  const selected = selectedKey ? (items.get(selectedKey) ?? null) : null;

  useEffect(() => {
    if (!selection) return;
    let current = true;
    setLoading(true);
    setError("");
    setItems(new Map());
    setSelectedItem(null);
    followRun.current = true;
    setFollowPaused(false);
    setLiveOutput(null);
    setChecked(new Set());
    setSelectionMode(false);
    setRetryRequest(0);
    setSaving(false);
    setRepoint(null);
    setRepointStrategy(null);
    setRemoval(null);
    // 换目录/批次：中断半截随之丢（稿矩阵⑨退出路径——换条目即不保留）。
    applyLiveOutput(null);
    setInflight(new Set());
    void api
      .listItems(selection.workdirId, selection.batchId)
      .then((view) => {
        if (!current) return;
        const loaded = itemsFromGroups(view.groups);
        setItems(loaded);
        // 跨重启恢复选中素材：只在首次装载生效一次；对装载结果校验不过就放弃。
        // ⑫ 旧档存的是裸条目键（无组前缀），退化成落原分组那行。
        const wanted = restoredItemRef.current;
        if (wanted !== null) {
          restoredItemRef.current = null;
          const row = loaded.get(itemKeyFromSelection(wanted));
          if (row)
            setSelectedItem(
              wanted.includes(":") ? wanted : selectionKey(row.status, row),
            );
        }
      })
      .catch((reason: unknown) => {
        // 后台加载失败分流：连接类走全局浮层（reportError 返回 null → 横幅不留红字），
        // 业务类才就地显示——与 refreshItems（:254）同一把尺，避免断连时页面铺一排红字。
        if (current) setError(reportError(reason) ?? "");
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [selection, applyLiveOutput]);

  const { batchRunState, setBatchRunState, setRunStateRevision } =
    useBatchRunState(selection);
  /** ⑫ 选中位带触发源组：列表点行由面板传本组 id，从别处跳转（概览「查看」／跑批跟随）缺省落原分组。 */
  const choose = useCallback((row: ItemRow, group: string = row.status) => {
    // 舞台缺席的两类（缺失／未导入）没有可预览的媒体——点行不出条目预览（稿④：甲·不加任何提示，
    // 原因与处置都在行上，行外观不弱化）。
    if (row.status === "missing" || row.status === "unimported") return;
    if (followRun.current) {
      // 从「跟随」切到「手动看」：跑批中这不是静默的——出可见提示（L2）。
      setFollowPaused(true);
    }
    followRun.current = false;
    setSelectedItem(selectionKey(group, row));
  }, []);
  // 选中素材落盘（跨重启恢复的写入侧）：换批次 / 换条目的清空也如实记 null。
  useEffect(() => {
    writeStoredJson(LABELING_SELECTED_ITEM_KEY, selectedItem);
  }, [selectedItem]);
  const requestRemoval = useCallback(
    (row: ItemRow) => {
      setRemoval({ identity, name: row.name });
    },
    [identity],
  );
  const toggleCheck = useCallback((item: string) => {
    setChecked((previous) => {
      const next = new Set(previous);
      if (next.has(item)) next.delete(item);
      else next.add(item);
      return next;
    });
  }, []);
  const retryChanged = useCallback(
    (retry: string[]) => {
      if (mounted.current && identityRef.current === identity) {
        setItems((previous) => withRetryItems(previous, retry));
      }
    },
    [identity],
  );
  const refreshItems = useCallback(
    async (requireSuccess = false) => {
      if (!selection) return;
      const version = ++refreshVersion.current;
      try {
        const view = await api.listItems(selection.workdirId, selection.batchId);
        if (
          !mounted.current ||
          identityRef.current !== identity ||
          version !== refreshVersion.current
        )
          return;
        setItems(itemsFromGroups(view.groups));
        setExportRevision((value) => value + 1);
        setError("");
        setItemsError("");
        setErrorRun(null);
      } catch (reason) {
        if (
          mounted.current &&
          identityRef.current === identity &&
          version === refreshVersion.current
        ) {
          // 条目取数失败与操作级失败分道：连接类走全局浮层，其余在列表槽里给固定句
          // （不拼后端 message——稿「分组头」⑨「列表三态对齐」）。
          if (reportError(reason) !== null) setItemsError("条目读取失败");
        }
        setErrorRun(corruptedRunOf(reason));
        if (requireSuccess) throw reason;
      }
    },
    [selection, identity],
  );
  // 行内处置＝点击直接执行（2026-10-10 用户裁「不经确认、不经弹窗」）：未导入行就地补登记、
  // 缺失行从登记在册的来源取回。成功后 toast ＋ 重取清单——行消失本身就是反馈。
  const recover = useCallback(
    async (row: ItemRow) => {
      if (!selection) return;
      setSaving(true);
      try {
        if (row.status === "unimported") {
          await registerInPlace(selection.workdirId, row.name);
          toast(`已导入「${row.name}」`);
        } else {
          await reimportFromSource(selection.workdirId, row.name);
          toast(`已重新导入「${row.name}」`);
        }
        await refreshItems();
      } catch (reason) {
        setError(errorMessage(reason));
      } finally {
        setSaving(false);
      }
    },
    [selection, refreshItems],
  );
  // 「重新指定」＝用户从目录选择弹窗挑一份文件顶替：按其所在目录做复制导入。
  // 不按扩展名过滤列表——收不收得进来由后端闸门判，界面吃它的真话（同一把尺）。
  const repointPicked = useCallback(
    async (picked: string) => {
      setRepoint(null);
      if (!selection) return;
      const cut = Math.max(picked.lastIndexOf("/"), picked.lastIndexOf("\\"));
      const source = cut > 0 ? picked.slice(0, cut) : picked;
      const name = cut > 0 ? picked.slice(cut + 1) : picked;
      setSaving(true);
      try {
        await importFromDirectory(selection.workdirId, source, name);
        toast(`已重新指定「${name}」`);
        await refreshItems();
      } catch (reason) {
        setError(errorMessage(reason));
      } finally {
        setSaving(false);
      }
    },
    [selection, refreshItems],
  );
  const removeRetry = useCallback(
    async (item?: string) => {
      if (!selection || saving) return;
      setSaving(true);
      try {
        const result = item
          ? await api.removeRetryItem(selection.workdirId, selection.batchId, item)
          : await api.clearRetryItems(selection.workdirId, selection.batchId);
        if (!mounted.current || identityRef.current !== identity) return;
        retryChanged(result.items);
        setError("");
      } catch (reason) {
        if (mounted.current && identityRef.current === identity)
          setError(errorMessage(reason));
      } finally {
        if (mounted.current && identityRef.current === identity) setSaving(false);
      }
    },
    [selection, saving, identity, retryChanged],
  );
  async function addSelected() {
    if (!selection || saving || !checked.size) return;
    setSaving(true);
    setError("");
    try {
      const result = await api.addRetryItems(selection.workdirId, selection.batchId, [
        ...checked,
      ]);
      if (!mounted.current || identityRef.current !== identity) return;
      retryChanged(result.items);
      setChecked(new Set());
      // 加入重试成功＝回常态（稿「头行 · 加入重试后」）；失败分支相反——留在多选态、勾选保留可重试。
      setSelectionMode(false);
    } catch (reason) {
      if (mounted.current && identityRef.current === identity)
        setError(errorMessage(reason));
    } finally {
      if (mounted.current && identityRef.current === identity) setSaving(false);
    }
  }
  // T14：run 在飞时左列分组按覆盖名单呈现（在飞行＝排队中）；名单空或不在飞即原样。
  const runInflight = batchRunState === "running" || batchRunState === "pending";
  const displayItems = useMemo(
    () => (runInflight ? withInflightOverride(items, inflight) : items),
    [runInflight, items, inflight],
  );
  // 展开钮＝稿 §22 .lb-list-toggle：仅窄屏显形（宽屏两列常驻、此钮恒无）；悬停＝暂展、
  // 点击／键盘＝暂展并把焦点送进层头返回钮；暂展期占位保留但不可见不可聚焦（出口改层头返回钮）。
  const listToggle = narrow ? (
    <Button
      ref={toggleRef}
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label="展开条目列表"
      aria-controls="lb-itemcol"
      aria-expanded={peek}
      className={peek ? "invisible" : undefined}
      onMouseEnter={() => openPeek(false)}
      onClick={() => openPeek(true)}
    >
      <PanelLeftOpenIcon />
    </Button>
  ) : undefined;
  const asset =
    selected && selection
      ? `/api/workdirs/${encodeURIComponent(selection.workdirId)}/items/${encodeURIComponent(selected.item)}/asset`
      : null;

  if (settingsWid)
    return (
      <WorkdirSettings
        key={settingsWid}
        wid={settingsWid}
        onBack={() => {
          setSettingsWid(null);
          void refreshItems();
        }}
        onChanged={() => setDirectoriesRevision((value) => value + 1)}
        onDeleted={() => {
          setSettingsWid(null);
          setDirectoriesRevision((value) => value + 1);
        }}
      />
    );

  return (
    <section
      className="@container/lbctx flex h-full min-h-0 flex-col"
      aria-label="打标"
    >
      {newStrategyWid && (
        <NewStrategyDialog
          key={newStrategyWid}
          wid={newStrategyWid}
          title={
            workdirs.find((entry) => entry.id === newStrategyWid)?.title ??
            newStrategyWid
          }
          nextSeq={(() => {
            const batches =
              workdirs.find((entry) => entry.id === newStrategyWid)?.batches ?? [];
            return batches.length
              ? Math.max(...batches.map((entry) => entry.seq)) + 1
              : 1;
          })()}
          onNavigateToSettings={onNavigateToSettings}
          onOpenWorkbench={onOpenWorkbench}
          onRepointStrategy={(entry) => {
            setNewStrategyWid(null);
            setRepointStrategy(entry);
          }}
          onClose={() => setNewStrategyWid(null)}
          onCreated={(batch) => {
            setWorkdirs((previous) =>
              previous.map((entry) =>
                entry.id === newStrategyWid
                  ? { ...entry, batches: [...entry.batches, batch] }
                  : entry,
              ),
            );
            setSelection({ workdirId: newStrategyWid, batchId: batch.id });
            setNewStrategyWid(null);
            setDirectoriesRevision((value) => value + 1);
          }}
        />
      )}
      {selection && removal?.identity === identity && (
        <RemoveUnimportedDialog
          key={`${identity}/${removal.name}`}
          wid={selection.workdirId}
          name={removal.name}
          onClose={() => setRemoval(null)}
          onRemoved={() => void refreshItems()}
        />
      )}
      {selection && repoint !== null && (
        <DirectoryPicker
          files
          onClose={() => setRepoint(null)}
          onSelect={(picked) => void repointPicked(picked)}
        />
      )}
      {repointStrategy && (
        <RepointStrategyDialog
          key={repointStrategy.id}
          strategy={repointStrategy}
          onClose={() => setRepointStrategy(null)}
          onRepointed={() => {
            setRepointStrategy(null);
            // 策略健康度变了：新建批次表单的策略来源下拉要重拉（坏行当场回 healthy）。
            setListsRevision((value) => value + 1);
          }}
        />
      )}
      {creating ? (
        // 新建批次＝全宽表单卡替换两栏（稿 `新建批次.html`「主区＝全宽表单卡替换两栏」／
        // behavior/pages.md L36；2026-10-14 用户令对稿，撤旧「画布内换块」的顶栏＋左列保留式）：
        // creating 态下顶栏、其下页级错误行与左列条目整块让位，表单铺满主区、自带内距与滚动。
        <NewBatchForm
          onBack={() => setCreating(false)}
          onNavigateToSettings={onNavigateToSettings}
          onOpenWorkbench={onOpenWorkbench}
          refreshKey={listsRevision}
          onCreated={(value) => {
            setCreating(false);
            setSelection(value);
            void loadWorkdirBatches()
              .then((loaded) => {
                if (mounted.current) setWorkdirs(loaded);
              })
              .catch((reason: unknown) => {
                if (mounted.current) setError(errorMessage(reason));
              });
          }}
        />
      ) : (
        <>
          {/* 顶栏＝§22 .lb-topbar：两列网格（左列 --w-col-left 320、右列吃满），右段内「胶囊串内容给宽、
          运行组 margin-left:auto 钉右缘」。窄屏走容器查询三段（挂载点＝本页根 @container/lbctx，
          对齐批「顶栏窄屏」①②）：<874 折行（右段 display:contents，运行组占第一行右、胶囊串掉第二行
          跨满）、触发件列渐缩 minmax(240,320)；<512 左列恒 240 不回涨。 */}
          <header className="grid shrink-0 grid-cols-[var(--w-col-left)_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-4 pt-4 pb-3 @max-[874px]/lbctx:grid-cols-[minmax(240px,320px)_minmax(auto,1fr)] @max-[512px]/lbctx:grid-cols-[240px_minmax(0,1fr)] lg:px-6">
            {/* 顶栏左段＝批次选择器＋新建批次入口。creating 态整块顶栏不渲染（新建批次＝全宽表单
            替换两栏，见本页 creating 分支），故此处无条件渲染、不再留「左段让位」的空格子。 */}
            <div className="flex min-w-0 items-center gap-3 pr-3">
              <div className="min-w-0 flex-1">
                <BatchSelector
                  workdirs={workdirs}
                  value={selection}
                  onChange={setSelection}
                  onSettings={setSettingsWid}
                  onNewStrategy={setNewStrategyWid}
                  runState={batchRunState}
                  loading={flight}
                  loadError={loadError}
                  onOpen={() => setDirectoriesRevision((revision) => revision + 1)}
                />
              </div>
              {/* 圆角统一 --r-md（对齐批「悬停/按压归一 + 顶部件三笔」⑥：基类 rounded-md＝
              --r-sm 8px，与同排选择器 chip 的 --r-md 12px 不同档，DESIGN.md 3.4 同行共用
              一套圆角基准）；补 Tip（⑤，图标钮必配气泡）。边界名随 2026-10-11 用户裁
              「新建跑批 → 新建批次」改名收口（对齐批「表单头与素材来源」⑱）。 */}
              <Tip label="新建批次">
                <Button
                  variant="ghost"
                  size="icon-lg"
                  className="rounded-lg"
                  aria-label="新建批次"
                  onClick={() => setCreating(true)}
                >
                  <PlusIcon />
                </Button>
              </Tip>
            </div>
            {/* 右段＝§22 .lb-topbar-right：折行档（<874）转 display:contents，让胶囊串与运行组直接落进
            顶栏网格——组钉第一行右缘、胶囊串掉第二行跨整行（让位秩序由两处子件自己声明）。 */}
            <div className="flex min-w-0 items-center gap-3 @max-[874px]/lbctx:contents">
              {selection && (
                <BatchConfiguration
                  key={`config/${identity}`}
                  wid={selection.workdirId}
                  batch={selection.batchId}
                  compact
                />
              )}
              {selection && (
                <RunControl
                  key={`${selection.workdirId}/${selection.batchId}`}
                  wid={selection.workdirId}
                  batch={selection.batchId}
                  retryRequest={retryRequest}
                  runStatus={batchRunState}
                  onRunStarted={(mode) => {
                    // T14：冻结这一场的名单——retry＝重试清单在飞的那些行；full＝当前
                    // 排队中＋未完成（全量计划吃的正是这些；done 与缺失不占位）。
                    const frozen = new Set<string>();
                    for (const [key, row] of itemsRef.current) {
                      if (row.status === "unimported") continue;
                      if (
                        mode === "retry"
                          ? row.in_retry === true
                          : row.status === "queued" || row.status === "failed"
                      ) {
                        frozen.add(key);
                      }
                    }
                    setInflight(frozen);
                  }}
                  onRunStatus={(status) => {
                    // "idle" = RunControl 探测到空闲（空闲哨兵）：不抹状态章，改触发
                    // latestRun 重读——抹空会把刚从磁盘读到的「已完成」等终态一并抹掉
                    //（挂载探测与 15 秒慢轮每次空闲都会报一次 idle，徽标最多活 15 秒）；
                    // 回读拿到的就是真实终态，要防的「卡 running」照样被复位，语义更准。
                    if (status === "idle") setRunStateRevision((value) => value + 1);
                    else setBatchRunState(status);
                    // 终态 = 跟随提示与「当前产出」都收场（运行结束后回到普通概览）。
                    // 例外＝ interrupted（手动停止，稿矩阵⑨）：半截内容留在原地、题字右侧
                    // 挂「已中断」标签（琥珀），不随终态清空——清掉的只有正常跑完/失败。
                    if (status !== "running" && status !== "pending") {
                      setFollowPaused(false);
                      if (status === "interrupted") {
                        applyLiveOutput(
                          liveOutputRef.current === null
                            ? null
                            : { ...liveOutputRef.current, stopped: "user" },
                        );
                      } else {
                        applyLiveOutput(null);
                      }
                      // T14：run 收场（含 idle 哨兵）＝视图层覆盖失效。
                      setInflight(new Set());
                      // ⑬ 跑批终态＝完整性报告已过时（失败同样）：递一次全量同步号触发自动重扫。
                      // 「idle」是空闲哨兵、不算终态，不在此列（否则每次空闲都会重扫）。
                      if (status !== "idle") setExportRevision((value) => value + 1);
                    }
                  }}
                  onFinish={() => refreshItems(true)}
                  onCurrentItem={(item) => {
                    // ⑫ 跑批跟随＝从别处跳转，落原分组那行；读数还没到位时按「排队中」占位。
                    if (!followRun.current) return;
                    if (item === null) {
                      // E5：中断后半截要留在原地（稿矩阵⑨）——终态的「收起跟随」让位，
                      // 否则右画布回概览、半截连标签一起被卸载。
                      if (liveOutputRef.current?.stopped) return;
                      setSelectedItem(null);
                      return;
                    }
                    const row = items.get(item);
                    setSelectedItem(
                      row ? selectionKey(row.status, row) : `queued:${item}`,
                    );
                  }}
                  onItemUpdate={(event) => {
                    refreshVersion.current += 1;
                    if (event.status === "started") {
                      // 新一轮开打：中断标记随空上下文一起复位（续跑重打该条）。
                      applyLiveOutput({ item: event.item, reasoning: "", content: "" });
                    }
                    setItems((previous) => withItemUpdate(previous, event));
                  }}
                  onItemDelta={(event) => {
                    // 读 ref 追加（与 applyLiveOutput 同一轨道）：updater 形式不写 ref，
                    // 后续中断标记会用旧 ref 把刚到的半截冲掉（E5 实锤）。
                    const current = liveOutputRef.current;
                    if (current === null || current.item !== event.item) return;
                    applyLiveOutput(
                      event.delta === "reasoning"
                        ? { ...current, reasoning: current.reasoning + event.text }
                        : { ...current, content: current.content + event.text },
                    );
                  }}
                  onItemsRefresh={() => void refreshItems()}
                  onStreamDrop={() =>
                    // SSE 断流：半截内容停在原处、标网络异常（红）；重连恢复即清。
                    applyLiveOutput(
                      liveOutputRef.current === null || liveOutputRef.current.stopped
                        ? liveOutputRef.current
                        : { ...liveOutputRef.current, stopped: "network" as const },
                    )
                  }
                  onStreamRestore={() =>
                    applyLiveOutput(
                      liveOutputRef.current === null ||
                        liveOutputRef.current.stopped !== "network"
                        ? liveOutputRef.current
                        : { ...liveOutputRef.current, stopped: null },
                    )
                  }
                />
              )}
            </div>
          </header>
          {error && !errorRun && (
            <FormError className="mx-6 mb-3 text-t-sm text-bad-ink">{error}</FormError>
          )}
          {/* 主区＝§22 .lb-grid：宽屏两列（左列 320＋画布吃满剩余）；<768 收起＝左列隐、画布满宽，
          暂展＝左列作浮出层叠在画布上（画布不位移）——不再上下堆叠，滚动归画布自身。 */}
          <div className="relative flex min-h-0 flex-1 gap-4 overflow-hidden px-4 pb-6 md:px-6">
            <MaterialsPanel
              items={displayItems}
              selection={selection}
              loading={loading}
              loadError={itemsError}
              narrow={narrow}
              peek={peek}
              backRef={backRef}
              onPeekBack={() => closePeek(true)}
              onPeekLeave={() => closePeek(false)}
              saving={saving}
              selectionMode={selectionMode}
              setSelectionMode={setSelectionMode}
              checked={checked}
              setChecked={setChecked}
              toggleCheck={toggleCheck}
              addSelected={addSelected}
              removeRetry={removeRetry}
              setRetryRequest={setRetryRequest}
              selectedItem={selectedItem}
              choose={choose}
              recover={recover}
              repoint={(name) => setRepoint(name)}
              requestRemoval={requestRemoval}
            />
            <div className="flex min-w-0 flex-1 flex-col overflow-auto">
              {followPaused && batchRunState === "running" && (
                // L2：停跟随从「静默停」改成「明说 + 一键恢复」。
                <div className="mb-3 flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-3 py-2 text-t-sm text-text-3">
                  <span>已暂停跟随正在打标的条目。</span>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      followRun.current = true;
                      setFollowPaused(false);
                      setSelectedItem(null);
                    }}
                  >
                    继续跟随
                  </Button>
                </div>
              )}
              {!selected && selection && !loading && (
                <BatchOverview
                  key={identity}
                  listToggle={listToggle}
                  wid={selection.workdirId}
                  workdirPath={
                    workdirs.find((entry) => entry.id === selection.workdirId)?.path ??
                    ""
                  }
                  batch={selection.batchId}
                  items={items}
                  exportRevision={exportRevision}
                  running={batchRunState === "running" || batchRunState === "pending"}
                  journalRun={errorRun}
                  onSelect={choose}
                  onImported={() => void refreshItems()}
                  onRepoint={(name) => setRepoint(name)}
                  onRetryChanged={retryChanged}
                />
              )}
              {!selected && !selection && (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
                  <FileImageIcon className="size-6" />
                  <p>选择素材</p>
                </div>
              )}
              {selected && (
                <MaterialDetail
                  key={`${identity}/${selectedKey ?? ""}`}
                  identity={identity}
                  listToggle={listToggle}
                  selected={selected}
                  asset={asset}
                  selection={selection}
                  batches={
                    workdirs.find((entry) => entry.id === selection?.workdirId)?.batches
                  }
                  foldedItem={foldedItem}
                  setFoldedItem={setFoldedItem}
                  liveOutput={liveOutput}
                  onBack={() => {
                    followRun.current = false;
                    setSelectedItem(null);
                  }}
                />
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
