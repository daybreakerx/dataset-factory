/**
 * 能力 · 技能（列表 + 详情双栏，含包内容预览与三种导入方式）——面板编排层。
 * 草稿与反馈状态、命令回调（启停 / 导入 / 删除 / 存文件 / 改名）住这里；
 * 展示块拆在同目录：skill-list / skill-detail（内嵌包内容胶囊）/ import-dialog /
 * delete-dialog；列表查询收拢在 use-skills（命令类留调用点）。
 */
import type { ReactElement } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SkillFileInfo, SkillImportResponse, SkillInfo } from "../../../api";
import { api } from "../../../api";
import { DirectoryPicker } from "../../../components/DirectoryPicker";
import { Alert, AlertDescription } from "../../../components/ui/alert";
import { type Feedback, reportError } from "../../../lib/feedback";
import { formatBytes } from "../../../lib/format";
import { DeleteDialog } from "./delete-dialog";
import { ImportDialog } from "./import-dialog";
import { SkillDetail } from "./skill-detail";
import { readSkillDrop } from "./skill-drop";
import { SkillList } from "./skill-list";
import { useSkills } from "./use-skills";

export function SkillsPanel(): ReactElement {
  const [selected, setSelected] = useState("");
  const [files, setFiles] = useState<SkillFileInfo[]>([]);
  const [previewPath, setPreviewPath] = useState("");
  const [previewContent, setPreviewContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState<string | null>(null);
  /** 名称草稿：null = 未改动。改名走独立接口（`POST /api/skills/{name}/rename`），不混在存文件里。 */
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const previewGeneration = useRef(0);
  const savePending = useRef(false);
  const togglePending = useRef(false);
  const [toggling, setToggling] = useState(false);
  const dirty =
    previewContent !== originalContent ||
    descriptionDraft !== null ||
    nameDraft !== null;
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [readingDrop, setReadingDrop] = useState(false);
  const dropPending = useRef(false);
  const [pathValue, setPathValue] = useState("");
  const [pickingPath, setPickingPath] = useState(false);

  /** 失败分流：连接类失败改弹浮层（不占界面位置），后端返回的业务错误仍就地展示。 */
  const fail = useCallback((err: unknown): void => {
    const text = reportError(err);
    if (text !== null) setFeedback({ kind: "error", text });
  }, []);

  const { skills, reload: fetchSkills } = useSkills(fail);

  const reload = useCallback(async (): Promise<void> => {
    const list = await fetchSkills();
    // 首次加载默认选中第一个技能（详情区直接有内容；用户可再点选其他）。
    setSelected((current) =>
      current === "" && list.length > 0 ? (list[0]?.name ?? "") : current,
    );
  }, [fetchSkills]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 选中变化 → 拉包文件清单；默认预览 SKILL.md（注入源）。改名后也走这里：包还在、路径没变，
  // 但 frontmatter 被重写过，重读一次才拿得到磁盘上的真基线。
  useEffect(() => {
    setNameDraft(null);
    const generation = ++previewGeneration.current;
    setPreviewPath("");
    setPreviewContent("");
    setOriginalContent("");
    setDescriptionDraft(null);
    if (selected === "") {
      setFiles([]);
      setPreviewPath("");
      setPreviewContent("");
      return;
    }
    let cancelled = false;
    setLoadingPreview(true);
    void (async () => {
      try {
        const result = await api.listSkillFiles(selected);
        if (cancelled) {
          return;
        }
        setFiles(result.files);
        const first = result.files.find((entry) => entry.previewable);
        if (first !== undefined) {
          const content = await api.readSkillFile(selected, first.path);
          if (!cancelled && generation === previewGeneration.current) {
            setPreviewPath(first.path);
            setPreviewContent(content.content);
            setOriginalContent(content.content);
          }
        }
      } catch (err) {
        if (!cancelled) {
          fail(err);
        }
      } finally {
        if (!cancelled && generation === previewGeneration.current)
          setLoadingPreview(false);
      }
    })();
    return () => {
      cancelled = true;
      previewGeneration.current += 1;
    };
  }, [selected, fail]);

  const current = skills.find((item) => item.name === selected);

  const pick = (name: string): void => {
    if (dirty || saving) return;
    setSelected(name);
    setFeedback(null);
  };

  const toggle = async (skill: SkillInfo): Promise<void> => {
    if (togglePending.current) return;
    togglePending.current = true;
    setToggling(true);
    try {
      await api.setSkillEnabled(skill.name, !skill.enabled);
      await reload();
    } catch (err) {
      fail(err);
    } finally {
      togglePending.current = false;
      setToggling(false);
    }
  };

  const applyImportResult = (result: SkillImportResponse): void => {
    const sizeText = formatBytes(result.total_bytes, "KiB", 1);
    setFeedback({
      kind: "success",
      text: `已导入「${result.name}」（${sizeText}——skill 全文将注入打标请求，体积偏大时留意 token 消耗）`,
    });
    setSelected(result.name);
  };

  const doImport = async (picked: File[]): Promise<void> => {
    setImporting(true);
    try {
      applyImportResult(await api.importSkillFiles(picked));
      await reload();
    } catch (err) {
      fail(err);
    } finally {
      setImporting(false);
    }
  };

  const doImportFile = async (picked: File | undefined): Promise<void> => {
    if (picked === undefined) {
      return;
    }
    setImporting(true);
    try {
      applyImportResult(await api.importSkillFile(picked));
      await reload();
    } catch (err) {
      fail(err);
    } finally {
      setImporting(false);
    }
  };

  const doImportPath = async (): Promise<void> => {
    const path = pathValue.trim();
    if (path === "") {
      return;
    }
    setImporting(true);
    try {
      applyImportResult(await api.importSkill(path));
      setPathValue("");
      await reload();
    } catch (err) {
      fail(err);
    } finally {
      setImporting(false);
    }
  };

  const drop = async (transfer: DataTransfer): Promise<void> => {
    if (dropPending.current || importing) return;
    dropPending.current = true;
    setReadingDrop(true);
    try {
      const picked = await readSkillDrop(transfer);
      if (picked.length === 0) throw new Error("没有可导入的文件。");
      if (picked.length === 1 && !(picked[0]?.webkitRelativePath ?? "").includes("/")) {
        await doImportFile(picked[0]);
      } else {
        await doImport(picked);
      }
    } catch (err) {
      fail(err);
    } finally {
      dropPending.current = false;
      setReadingDrop(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (selected === "") {
      return;
    }
    try {
      await api.deleteSkill(selected);
      setDeleteDialogOpen(false);
      setFeedback({ kind: "success", text: `已删除「${selected}」` });
      setSelected("");
      await reload();
    } catch (err) {
      setDeleteDialogOpen(false);
      fail(err);
    }
  };

  const openPreview = async (path: string): Promise<void> => {
    if (selected === "" || dirty || savePending.current) {
      return;
    }
    const generation = ++previewGeneration.current;
    setLoadingPreview(true);
    try {
      const content = await api.readSkillFile(selected, path);
      if (generation !== previewGeneration.current) return;
      setPreviewPath(path);
      setPreviewContent(content.content);
      setOriginalContent(content.content);
      setDescriptionDraft(null);
    } catch (err) {
      if (generation === previewGeneration.current) fail(err);
    } finally {
      if (generation === previewGeneration.current) setLoadingPreview(false);
    }
  };

  const save = async (): Promise<void> => {
    if (savePending.current || loadingPreview || !dirty) return;
    const nextName = (nameDraft ?? selected).trim();
    if (nextName === "") {
      setFeedback({ kind: "error", text: "名称不能为空；请填写技能名称。" });
      return;
    }
    const renamed = nextName !== selected;
    savePending.current = true;
    setSaving(true);
    const generation = previewGeneration.current;
    try {
      const result = await api.saveSkillFile(selected, previewPath, {
        content: previewContent,
        original_content: originalContent,
        ...(descriptionDraft !== null ? { description: descriptionDraft } : {}),
      });
      if (generation !== previewGeneration.current) return;
      setPreviewContent(result.content);
      setOriginalContent(result.content);
      setDescriptionDraft(null);
      if (renamed) {
        // 改名排在存内容之后：改名会重写 SKILL.md 的 frontmatter（name 与目录名一起换），
        // 先改名就让刚读到的并发基线失效了（实测 PUT 当场 400）。换完名由选中项变化触发
        // 重读，编辑器里看到的是磁盘上带新名的正文，下一次保存的基线也就对了。
        await api.renameSkill(selected, { new_name: nextName });
        setSelected(nextName);
      }
      setFeedback({
        kind: "success",
        text: renamed ? `已保存并改名为「${nextName}」` : "已保存",
      });
      await reload();
    } catch (err) {
      if (generation === previewGeneration.current) fail(err);
    } finally {
      savePending.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-card lg:grid lg:grid-cols-[340px_minmax(0,1fr)] lg:overflow-hidden">
      {/* 左：列表 + 导入 */}
      <SkillList
        disabled={dirty || saving}
        skills={skills}
        selected={selected}
        toggling={toggling}
        onToggle={(skill) => void toggle(skill)}
        onPick={pick}
        onImport={() => {
          setFeedback(null);
          setImportOpen(true);
        }}
      />
      <ImportDialog
        open={importOpen}
        onOpenChange={(open) => {
          if (!importing && !readingDrop) setImportOpen(open);
        }}
        importing={importing}
        readingDrop={readingDrop}
        feedback={feedback}
        pathValue={pathValue}
        onPathInput={setPathValue}
        onPickPath={() => setPickingPath(true)}
        onImportFiles={(picked) => void doImport(picked)}
        onImportFile={(picked) => void doImportFile(picked)}
        onImportPath={() => void doImportPath()}
        onDrop={(transfer) => void drop(transfer)}
      />

      {/* 右：详情 + 包内容预览 */}
      <div className="flex min-w-0 shrink-0 flex-1 flex-col border-t border-border p-4 lg:min-h-0 lg:overflow-y-auto lg:border-t-0 lg:border-l lg:px-8 lg:py-6">
        {!importOpen && feedback !== null && (
          <Alert variant={feedback.kind === "error" ? "destructive" : "success"}>
            <AlertDescription>{feedback.text}</AlertDescription>
          </Alert>
        )}
        {current !== undefined ? (
          <SkillDetail
            current={current}
            nameDraft={nameDraft}
            onNameChange={(value) =>
              setNameDraft(value === current.name ? null : value)
            }
            saving={saving}
            loadingPreview={loadingPreview}
            dirty={dirty}
            onDelete={() => setDeleteDialogOpen(true)}
            files={files}
            previewPath={previewPath}
            onOpenPreview={(path) => void openPreview(path)}
            previewContent={previewContent}
            onPreviewChange={setPreviewContent}
            descriptionDraft={descriptionDraft}
            onDescriptionChange={(value) =>
              setDescriptionDraft(value === current.description ? null : value)
            }
            onRevert={() => {
              setPreviewContent(originalContent);
              setDescriptionDraft(null);
              setNameDraft(null);
            }}
            onSave={() => void save()}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-t-md text-muted-foreground">
            左侧选择一个技能查看详情与包内容。
          </div>
        )}
      </div>

      {pickingPath && (
        <DirectoryPicker
          files
          suffixes={[".md", ".txt"]}
          onClose={() => setPickingPath(false)}
          onSelect={(path) => {
            setPathValue(path);
            setPickingPath(false);
          }}
        />
      )}
      <DeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        target={selected}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
