import { ArrowLeftIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { ApiError, api, type TaskView } from "../../../api";
import type { components } from "../../../api-types.gen";
import { DirectoryPicker } from "../../../components/DirectoryPicker";
import { Button } from "../../../components/ui/button";
import { reportError } from "../../../lib/feedback";
import { cn } from "../../../lib/utils";
import { parseImportReport } from "../runs/import-report";
import type { BatchSelection } from "./BatchSelector";
import { BatchSourceFields, idleInfo, type SourceInfo } from "./batch-source-fields";
import { BatchStrategyFields } from "./batch-strategy-fields";
import { RepointStrategyDialog } from "./RepointStrategyDialog";
import { useBatchFormLists } from "./use-batch-form-lists";

type Workdir = components["schemas"]["WorkdirInfo"];
type ScanPreviewView = components["schemas"]["ScanPreviewView"];
type StrategyView = components["schemas"]["StrategyView"];

/** 导入／登记完成后的信息位（§22 .nb-doneinfo 的取数）。 */
interface DoneInfo {
  verb: "已导入" | "已登记";
  total: number;
  images: number;
  videos: number;
  rejected: number;
}

interface Props {
  onBack: () => void;
  onCreated: (selection: BatchSelection) => void;
  /** 跳应用级设置页（下拉的齿轮出口——想加端点 / 启用 Skill 不必自己摸路）。 */
  onNavigateToSettings?: () => void;
  /** 跳策略页对话区（「拿不准效果？先在对话中用单张试标」动线）。 */
  onOpenWorkbench?: () => void;
  /** 外部驱动的四表重拉信号（「重新指定」弹窗修好策略引用后＋1：坏行当场回 healthy）。 */
  refreshKey?: number;
}

/**
 * 新建批次（稿 #15a＋#15b，2026-10-09 交互流重设计／2026-10-11 头行改版）。
 *
 * 三段流程各自一个出口，不再一钮跑到底：**扫描**（读素材来源目录，不登记）→
 * **导入／登记**（登记工作目录并把素材收进来）→ 头行**创建批次**（只建批次，成功即
 * 回主页面）。启动跑批不在这里——回到主页面由「开始打标」（运行状态组现役件）承担。
 */
export function NewBatchForm({
  onBack,
  onCreated,
  onNavigateToSettings,
  onOpenWorkbench,
  refreshKey = 0,
}: Props) {
  const id = useId();
  const lists = useBatchFormLists();
  // 四张库表的取数三态（设置页左列同款口径）：不给这一句，「拉不到」会被说成「库里没有」。
  const listsStateText =
    lists.error !== "" ? "配置读取失败" : lists.loaded ? "" : "正在读取…";
  const [mode, setMode] = useState<"copy" | "inplace">("copy");
  const [source, setSource] = useState("");
  const [path, setPath] = useState("");
  const [library, setLibrary] = useState("scratch");
  const [name, setName] = useState("");
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [directoryField, setDirectoryField] = useState<"source" | "path" | null>(null);
  // 扫描三件：结果、失败真话、在飞（扫描对象＝来源目录，就地态＝那一份目录）。
  const [scan, setScan] = useState<ScanPreviewView | null>(null);
  const [scanError, setScanError] = useState("");
  const [scanning, setScanning] = useState(false);
  // 导入／登记三件：登记到的工作目录、可续接的长任务句柄、完成位。
  const [workdir, setWorkdir] = useState<Workdir | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState<DoneInfo | null>(null);
  const [actionError, setActionError] = useState("");
  // 创建批次（头行主钮）两件：在飞与失败真话——都落头行消息槽，一槽一消息互斥替换。
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  // 「重新指定」弹窗（2026-10-13 E4）：策略来源下拉的引用缺失行点出来的修复出口。
  const [repointing, setRepointing] = useState<StrategyView | null>(null);
  const mounted = useRef(false);
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wake = useRef<(() => void) | undefined>(undefined);
  // 外部重拉信号（refreshKey 变化＝「重新指定」弹窗修好了策略引用）：重拉四表、
  // 不重挂表单（取最新闭包用 ref 承接，先例＝NewStrategyDialog 的 load ref）。
  const reloadLists = useRef(lists.reload);
  reloadLists.current = lists.reload;
  useEffect(() => {
    if (refreshKey > 0) reloadLists.current();
  }, [refreshKey]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
      wake.current?.();
    };
  }, []);

  const scanTarget = (mode === "copy" ? source : path).trim();

  /** 来源变了，旧扫描就不作数了——信息行退回就地警告（笔⑪：扫描后被顶掉、改动后回显）。 */
  function invalidateScan(): void {
    setScan(null);
    setScanError("");
  }

  async function runScan(): Promise<void> {
    if (scanTarget === "" || scanning || done !== null) return;
    setScanning(true);
    setScanError("");
    try {
      setScan(await api.scanSource(scanTarget));
    } catch (reason) {
      setScan(null);
      // 连接类走浮层（reportError 返回 null → 就地不留红字）；业务类后端有真话用真话、
      // 一句都没有才落稿的示意句（笔⑫，撤原空 catch 静默）。
      const scanMsg = reportError(reason);
      setScanError(scanMsg === null ? "" : scanMsg || "扫描失败，请重试");
    } finally {
      if (mounted.current) setScanning(false);
    }
  }

  /** 导入／登记：copy＝登记工作目录并从来源复制进来；就地＝登记该目录并把素材记进册（不动素材）。 */
  async function runImport(): Promise<void> {
    if (pending.current || (workdir !== null && done !== null)) return;
    pending.current = true;
    setImporting(true);
    setActionError("");
    setScanError("");
    try {
      let directory = workdir;
      let handle = taskId;
      if (directory === null) {
        const accepted = await api.createWorkdir({
          path: path.trim(),
          source: mode === "copy" ? source.trim() : null,
          title: "",
        });
        if (!mounted.current) return;
        directory = accepted.workdir;
        handle = accepted.task_id;
        setWorkdir(directory);
        setTaskId(handle);
      }
      if (handle === null) {
        // 目录已登记、任务句柄却没了（服务重启丢掉在飞任务）：补发一次导入续上，
        // 不重复登记工作目录（createWorkdir 只在 directory===null 那一段发过）。
        const accepted = await api.importMaterials(directory.id, {
          source: mode === "copy" ? source.trim() : null,
        });
        if (!mounted.current) return;
        handle = accepted.task_id;
        setTaskId(handle);
      }
      while (mounted.current) {
        const task: TaskView = await api.getTask(handle).catch((reason: unknown) => {
          if (mounted.current && reason instanceof ApiError && reason.status === 404) {
            setTaskId(null);
            throw new Error("上次任务已丢失（服务重启过），可重新执行");
          }
          throw reason;
        });
        if (!mounted.current) return;
        if (task.id !== handle) throw new Error("导入任务响应不一致");
        setPercent(Math.round(task.progress * 100));
        if (task.status === "succeeded") {
          const report = parseImportReport(task.result);
          setDone({
            verb: mode === "copy" ? "已导入" : "已登记",
            total: report.imported.length,
            images: report.imported_images,
            videos: report.imported_videos,
            rejected: report.rejected.length,
          });
          setScan(null);
          break;
        }
        if (task.status !== "running") {
          setTaskId(null);
          throw new Error(task.error || "导入未完成，可重新执行");
        }
        await new Promise<void>((resolve) => {
          wake.current = resolve;
          timer.current = setTimeout(resolve, 2000);
        });
      }
    } catch (reason) {
      if (mounted.current) setActionError(reportError(reason) ?? "");
    } finally {
      pending.current = false;
      if (mounted.current) {
        setImporting(false);
        setPercent(null);
      }
    }
  }

  /** 创建批次＝只做 createBatch；成功即回主页面，启动归主页面的「开始打标」（笔⑥）。 */
  async function runCreate(): Promise<void> {
    if (workdir === null || creating) return;
    setCreating(true);
    setCreateError("");
    try {
      const created = await api.createBatch(
        workdir.id,
        library === "scratch"
          ? {
              type: "scratch",
              name: name.trim(),
              endpoint_id: lists.endpoint,
              prompt_id: lists.prompt,
              skill_ids: selectedSkills,
            }
          : { type: "library", id: library, name: name.trim() || null },
      );
      onCreated({ workdirId: workdir.id, batchId: created.id });
    } catch (reason) {
      if (mounted.current) {
        const createMsg = reportError(reason);
        setCreateError(
          createMsg === null ? "" : createMsg || "创建批次失败，可重新执行",
        );
      }
    } finally {
      if (mounted.current) setCreating(false);
    }
  }

  const info: SourceInfo =
    done !== null
      ? { kind: "done", ...done }
      : percent !== null
        ? {
            kind: "progress",
            verb: mode === "copy" ? "正在导入" : "正在登记",
            percent,
          }
        : actionError
          ? { kind: "error", text: actionError }
          : scanError
            ? { kind: "error", text: scanError }
            : scan !== null
              ? { kind: "scan", view: scan }
              : idleInfo(mode);
  const flight = scanning || importing;
  const canCreate =
    done !== null &&
    !creating &&
    lists.loaded &&
    (library !== "scratch" || (!!name.trim() && !!lists.endpoint && !!lists.prompt));
  const message = creating
    ? { role: "status" as const, tone: "text-info-ink", text: "正在创建批次" }
    : createError
      ? { role: "alert" as const, tone: "text-bad-ink", text: createError }
      : null;

  return (
    <section aria-label="新建批次" className="h-full overflow-auto px-6 pt-4 pb-6">
      {directoryField && (
        <DirectoryPicker
          initialPath={directoryField === "source" ? source : path}
          allowCreate
          allowRename
          onClose={() => setDirectoryField(null)}
          onSelect={(value) => {
            if (directoryField === "source") setSource(value);
            else setPath(value);
            invalidateScan();
            setDirectoryField(null);
          }}
        />
      )}
      {/* 头行＝§22 .nb-topbar：返回钮＋页题＋消息槽（flex:1 吃满中段）＋行尾主钮。
          页题复用 §31 .wd-title（t-xl／medium），题不再在卡内。 */}
      <header className="mb-4 flex items-center gap-3">
        <Button
          variant="ghost"
          size="lg"
          aria-label="返回主页面"
          disabled={importing || creating}
          onClick={onBack}
        >
          <ArrowLeftIcon />
          返回主页面
        </Button>
        <h1 className="shrink-0 text-t-xl font-medium leading-(--lh-tight) text-text-1">
          新建批次
        </h1>
        {message && (
          <span
            role={message.role}
            className={cn("min-w-0 flex-1 truncate text-t-sm", message.tone)}
          >
            {message.text}
          </span>
        )}
        <Button
          variant="default"
          size="lg"
          disabled={!canCreate}
          aria-disabled={creating || undefined}
          className={cn("ml-auto", creating && "aria-disabled:pointer-events-none")}
          onClick={() => void runCreate()}
        >
          创建批次
        </Button>
      </header>
      {/* 表单白卡＝§22 .nb-card：内距 --s-6、圆角 --r-lg、sh-1；卡内两区头各领一段。 */}
      <div className="flex min-w-0 flex-col rounded-xl border border-border bg-card p-6 shadow-(--sh-1)">
        <h2 className="mb-4 text-t-xl font-medium leading-(--lh-tight) text-text-1">
          素材
        </h2>
        <BatchSourceFields
          id={id}
          mode={mode}
          source={source}
          path={path}
          info={info}
          frozen={done !== null}
          flight={flight}
          canScan={scanTarget !== ""}
          onModeChange={(value) => {
            setMode(value);
            invalidateScan();
          }}
          onSourceChange={(value) => {
            setSource(value);
            invalidateScan();
          }}
          onPathChange={(value) => {
            setPath(value);
            invalidateScan();
          }}
          onPickDirectory={setDirectoryField}
          onScan={() => void runScan()}
          onImport={() => void runImport()}
        />
        <h2 className="mb-4 mt-8 text-t-xl font-medium leading-(--lh-tight) text-text-1">
          策略
        </h2>
        <BatchStrategyFields
          id={id}
          library={library}
          name={name}
          endpoint={lists.endpoint}
          prompt={lists.prompt}
          selectedSkills={selectedSkills}
          strategies={lists.strategies}
          endpoints={lists.endpoints}
          prompts={lists.prompts}
          skills={lists.skills}
          busy={creating}
          stateText={listsStateText}
          onLibraryChange={(value) => {
            setLibrary(value);
            setName(lists.strategies.find((entry) => entry.id === value)?.name ?? "");
          }}
          onNameChange={setName}
          onEndpointChange={lists.setEndpoint}
          onPromptChange={lists.setPrompt}
          onSelectedSkillsChange={setSelectedSkills}
          onNavigateToSettings={onNavigateToSettings}
          onOpenWorkbench={onOpenWorkbench}
          onRepointStrategy={setRepointing}
        />
        {/* 试标动线（策略件笔⑩）：hint 一句＋accent 小钮，去向＝策略页对话区。
            原第二行「体积上限…」meter 撤——体积与扩展名范围已进扫描钮气泡（笔⑦）。 */}
        {onOpenWorkbench !== undefined && (
          <div className="mt-6 flex items-center gap-3 text-t-sm text-text-3">
            <span>拿不准效果？先在对话中用单张试标，满意后再跑整批。</span>
            <Button variant="accent" size="xs" onClick={onOpenWorkbench}>
              前往策略页面调试
            </Button>
          </div>
        )}
      </div>
      {repointing && (
        <RepointStrategyDialog
          key={repointing.id}
          strategy={repointing}
          onClose={() => setRepointing(null)}
          onRepointed={() => {
            setRepointing(null);
            lists.reload();
          }}
        />
      )}
    </section>
  );
}
