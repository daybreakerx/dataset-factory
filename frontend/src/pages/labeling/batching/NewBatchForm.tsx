import { ArrowLeftIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { ApiError, api, errorMessage, type TaskView } from "../../../api";
import type { components } from "../../../api-types.gen";
import { DirectoryPicker } from "../../../components/DirectoryPicker";
import { DialogShell } from "../../../components/dialog-shell";
import { FormError } from "../../../components/form-error";
import { Button } from "../../../components/ui/button";
import { type ImportReport, parseImportReport } from "../runs/import-report";
import { ImportMaterialsDialog } from "../workdir/ImportMaterialsDialog";
import type { BatchSelection } from "./BatchSelector";
import { BatchSourceFields } from "./batch-source-fields";
import { BatchStrategyFields } from "./batch-strategy-fields";
import { useBatchFormLists } from "./use-batch-form-lists";

type Workdir = components["schemas"]["WorkdirInfo"];
type Batch = components["schemas"]["BatchView"];
interface Props {
  onBack: () => void;
  onCreated: (selection: BatchSelection) => void;
  /** 跳应用级设置页（下拉的齿轮出口——想加端点 / 启用 Skill 不必自己摸路）。 */
  onNavigateToSettings?: () => void;
  /** 跳对话工作台（「拿不准效果？先在对话中用单张试标」动线）。 */
  onOpenWorkbench?: () => void;
}

export function NewBatchForm({
  onBack,
  onCreated,
  onNavigateToSettings,
  onOpenWorkbench,
}: Props) {
  const id = useId();
  const lists = useBatchFormLists();
  const [mode, setMode] = useState<"copy" | "inplace">("copy");
  const [path, setPath] = useState("");
  const [source, setSource] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [library, setLibrary] = useState("scratch");
  const [name, setName] = useState("");
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [workdir, setWorkdir] = useState<Workdir | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [importDone, setImportDone] = useState(false);
  const [initialImportReport, setInitialImportReport] = useState<ImportReport | null>(
    null,
  );
  const rejectedImports = useRef<{ name: string; reason: string }[]>([]);
  const [unimported, setUnimported] = useState<
    { name: string; reason: string | null | undefined }[] | null
  >(null);
  const [importOpen, setImportOpen] = useState(false);
  const [directoryField, setDirectoryField] = useState<"source" | "path" | null>(null);
  const mounted = useRef(false);
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wake = useRef<(() => void) | undefined>(undefined);
  // 发车前摘要：登记完成后（拿到 wid）拉一次扫描预览——
  // 「这一跑会吃多少、收哪些、不收哪些、为什么」在发车按钮上方一眼可读。
  const [scan, setScan] = useState<components["schemas"]["ScanPreviewView"] | null>(
    null,
  );

  useEffect(() => {
    if (workdir === null) {
      setScan(null);
      return;
    }
    let current = true;
    api
      .scanPreview(workdir.id)
      .then((value) => {
        if (current) setScan(value);
      })
      .catch(() => {
        // 摘要读不到不挡发车（主流程自己会报错），留空即可。
      });
    return () => {
      current = false;
    };
  }, [workdir]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
      wake.current?.();
    };
  }, []);

  async function run(skipConfirmation = false) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    lists.setError("");
    try {
      let directory = workdir;
      let importTask = taskId;
      if (!directory) {
        setProgress("正在登记工作目录");
        const accepted = await api.createWorkdir({
          path: path.trim(),
          source: mode === "copy" ? source.trim() : null,
          title: "",
        });
        if (!mounted.current) return;
        directory = accepted.workdir;
        importTask = accepted.task_id;
        setWorkdir(directory);
        setTaskId(importTask);
      }
      if (!importDone && !importTask) {
        const accepted = await api.importMaterials(directory.id, {
          source: mode === "copy" ? source.trim() : null,
        });
        if (!mounted.current) return;
        importTask = accepted.task_id;
        setTaskId(importTask);
      }
      if (!importDone && importTask) {
        while (mounted.current) {
          const task: TaskView = await api
            .getTask(importTask)
            .catch((reason: unknown) => {
              if (
                mounted.current &&
                reason instanceof ApiError &&
                reason.status === 404
              ) {
                setTaskId(null);
                throw new Error("上次任务已丢失（服务重启过），可重新执行");
              }
              throw reason;
            });
          if (!mounted.current) return;
          if (task.id !== importTask) throw new Error("导入任务响应不一致");
          setProgress(`正在导入 · ${Math.round(task.progress * 100)}%`);
          if (task.status === "succeeded") {
            const report = parseImportReport(task.result);
            rejectedImports.current = report.rejected;
            setProgress(`导入完成 · 新增 ${report.imported.length} 项`);
            setImportDone(true);
            const hasFeedback =
              report.skipped_identical.length > 0 ||
              report.skipped_conflict.length > 0 ||
              report.skipped_duplicate.length > 0;
            if (hasFeedback) {
              setInitialImportReport(report);
              setImportOpen(true);
              return;
            }
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
      }
      if (!mounted.current) return;
      let createdBatch = batch;
      if (!createdBatch) {
        setProgress("正在创建批次");
        createdBatch = await api.createBatch(
          directory.id,
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
        if (!mounted.current) return;
        setBatch(createdBatch);
      }
      if (!skipConfirmation) {
        const view = await api.listItems(directory.id, createdBatch.id);
        if (!mounted.current) return;
        const registered = new Set(
          Object.entries(view.groups)
            .filter(([group]) => group !== "unimported")
            .flatMap(([, rows]) => rows.map((row) => row.name)),
        );
        const omitted = new Map(
          rejectedImports.current
            .filter((row) => !registered.has(row.name))
            .map((row) => [row.name, row]),
        );
        for (const row of view.groups.unimported ?? [])
          omitted.set(row.name, { name: row.name, reason: row.reason ?? "未登记" });
        if (omitted.size) {
          setUnimported([...omitted.values()]);
          return;
        }
      }
      setProgress("正在启动");
      await api.startRun(directory.id, createdBatch.id, "full");
      if (mounted.current)
        onCreated({ workdirId: directory.id, batchId: createdBatch.id });
    } catch (reason) {
      if (mounted.current) lists.setError(errorMessage(reason));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const valid =
    lists.loaded &&
    !!path.trim() &&
    (mode === "copy" ? !!source.trim() : acknowledged) &&
    (library !== "scratch" || (!!name.trim() && !!lists.endpoint && !!lists.prompt));

  return (
    <section aria-label="新建跑批" className="h-full overflow-auto px-6 py-4">
      {directoryField && (
        <DirectoryPicker
          initialPath={directoryField === "source" ? source : path}
          onClose={() => setDirectoryField(null)}
          onSelect={(value) => {
            if (directoryField === "source") setSource(value);
            else setPath(value);
            setDirectoryField(null);
          }}
        />
      )}
      {workdir && importOpen && (
        <ImportMaterialsDialog
          wid={workdir.id}
          initialMode={mode}
          initialSource={source.trim()}
          initialReport={initialImportReport ?? undefined}
          onClose={() => {
            setImportOpen(false);
            setInitialImportReport(null);
          }}
          onImported={() => {
            setUnimported(null);
          }}
        />
      )}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            aria-label="返回打标页"
            disabled={busy}
            onClick={onBack}
          >
            <ArrowLeftIcon />
          </Button>
          <h1 className="text-t-2xl font-semibold">新建跑批</h1>
        </div>
        <BatchSourceFields
          id={id}
          mode={mode}
          source={source}
          path={path}
          acknowledged={acknowledged}
          disabled={busy || !!workdir}
          onModeChange={setMode}
          onSourceChange={setSource}
          onPathChange={setPath}
          onAcknowledgeChange={setAcknowledged}
          onPickDirectory={setDirectoryField}
        />
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
          busy={busy}
          batchLocked={!!batch}
          onLibraryChange={(value) => {
            setLibrary(value);
            setName(lists.strategies.find((entry) => entry.id === value)?.name ?? "");
          }}
          onNameChange={setName}
          onEndpointChange={lists.setEndpoint}
          onPromptChange={lists.setPrompt}
          onSelectedSkillsChange={setSelectedSkills}
          onNavigateToSettings={onNavigateToSettings}
        />
        {scan !== null && (
          // 扫描摘要行：登记完成后、发车之前，先告诉用户
          // 这一跑会吃多少、收哪些、不收哪些、为什么。
          <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-t-sm">
            <span className="font-medium">
              扫描到 {scan.total} 项：图片 {scan.images} · 视频 {scan.videos}
            </span>
            <span className="text-muted-foreground">
              ；未导入 {scan.unimported.length} 项
              {scan.unimported.length > 0 ? "（明细在发车前确认里）" : ""}
            </span>
          </div>
        )}
        {lists.error && !unimported && (
          <FormError className="text-bad-ink">{lists.error}</FormError>
        )}
        {progress && (
          <p role="status" className="text-t-sm text-muted-foreground">
            {progress}
          </p>
        )}
        <DialogShell
          open={!!unimported && !importOpen}
          onOpenChange={(open) => !open && !busy && setUnimported(null)}
          title="开始打标前确认"
          description={<>有 {unimported?.length ?? 0} 个素材未登记，本次不会打标。</>}
          cancel={{
            label: "先去导入",
            variant: "ghost",
            size: "sm",
            disabled: busy,
            onClick: () => setImportOpen(true),
          }}
          confirm={{
            label: "仍要开始",
            variant: "default",
            size: "sm",
            disabled: busy,
            onClick: () => void run(true),
          }}
        >
          <ul className="max-h-48 overflow-auto text-t-sm" aria-label="未导入素材">
            {unimported?.map((row) => (
              <li
                key={row.name}
                className="flex flex-wrap gap-2 border-b border-border/60 py-2 last:border-0"
              >
                <span className="break-all font-medium">{row.name}</span>
                <span className="break-words text-muted-foreground">{row.reason}</span>
              </li>
            ))}
          </ul>
          {lists.error && (
            <FormError className="text-t-sm text-bad-ink">{lists.error}</FormError>
          )}
        </DialogShell>
        {!unimported && (
          <div className="space-y-3 border-t border-border pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                className="ml-auto"
                disabled={!valid || busy}
                onClick={() => void run()}
              >
                {busy ? "正在处理" : "开始打标"}
              </Button>
            </div>
            {/* 底部动线与体积预告。 */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-t-xs text-muted-foreground">
              {onOpenWorkbench !== undefined && (
                <button
                  type="button"
                  className="text-primary underline underline-offset-4"
                  onClick={onOpenWorkbench}
                >
                  拿不准效果？先在对话中用单张试标
                </button>
              )}
              <span className="ml-auto">
                体积上限：单图 ≤ 20 MiB · 单视频 ≤ 100 MiB
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
