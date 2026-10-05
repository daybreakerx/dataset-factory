/**
 * 能力 · 技能（列表 + 详情双栏，含包内容预览与三种导入方式）——面板编排层。
 * 草稿与反馈状态、命令回调（启停 / 导入 / 删除 / 存文件 / 改名）住这里；
 * 展示块拆在同目录：skill-list / skill-detail（内嵌包内容胶囊）/ import-dialog /
 * delete-dialog；列表查询收拢在 use-skills（命令类留调用点）。
 * 寻址一律用 skill ID（显示名可重名——坏包占位名「技能已损坏」可同名撞键）。
 */
import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SkillFileInfo, SkillImportResponse, SkillInfo } from "../../../api";
import { api } from "../../../api";
import { DirectoryPicker } from "../../../components/DirectoryPicker";
import { UnsavedConfirmDialog } from "../../../components/unsaved-confirm-dialog";
import { useVscrollColumn } from "../../../components/vscroll";
import { type Feedback, reportError } from "../../../lib/feedback";
import { formatBytes } from "../../../lib/format";
import { toast } from "../../../lib/toast";
import type { PanelUnsavedActions } from "../../../lib/unsaved-actions";
import { DeleteDialog } from "./delete-dialog";
import { ImportDialog } from "./import-dialog";
import { SkillDetail } from "./skill-detail";
import { readSkillDrop } from "./skill-drop";
import { SkillList } from "./skill-list";
import { rescueSkillFrontmatter } from "./skill-rescue";
import { useSkills } from "./use-skills";

export function SkillsPanel({
  onSettingsDirtyChange,
  onRegisterActions,
}: {
  /** dirty 变化上报（壳层拦设置子侧栏切子页；卸载时上报 false）。 */
  onSettingsDirtyChange?: (dirty: boolean) => void;
  /** 注册保存／回退接口供壳层弹窗三路行为调用；卸载时注销。 */
  onRegisterActions?: (actions: PanelUnsavedActions | null) => void;
}): ReactElement {
  const [selected, setSelected] = useState("");
  const [files, setFiles] = useState<SkillFileInfo[]>([]);
  const [previewPath, setPreviewPath] = useState("");
  const [previewContent, setPreviewContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  /** SKILL.md 的磁盘原文（抢救预填的输入；描述行的取值不随预览文件切换丢失）。 */
  const [skillMdOriginal, setSkillMdOriginal] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState<string | null>(null);
  /** 名称草稿：null = 未改动。改名走独立接口（`POST /api/skills/{id}/rename`），不混在存文件里。 */
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
  // ---------- 未保存确认弹窗（面板内离开动作的兜底） ----------
  const [unsavedOpen, setUnsavedOpen] = useState(false);
  const [unsavedError, setUnsavedError] = useState("");
  const [unsavedBusy, setUnsavedBusy] = useState(false);
  const [leaveAction, setLeaveAction] = useState<
    { kind: "pick"; id: string } | { kind: "preview"; path: string } | null
  >(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  // 详情头行消息槽（一槽一消息、互斥替换）：保存被拦（bad）／保存成功（ok）优先，
  // 其余回落损坏档常态（warn／bad）——对齐批「技能侧反馈归一」（批 14）。
  // nameBlocked＝消息来自空名拦截，供名字框挂 aria-invalid（字段级错误程序化关联）。
  const [headMsg, setHeadMsg] = useState<{
    kind: "ok" | "warn" | "bad";
    text: string;
    nameBlocked?: boolean;
  } | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  // 删除飞行期与失败行：提交后回包前两钮只失效不换装；业务错误就地进弹窗
  // （弹窗保持打开），连接类失败由 reportError 改走浮层（稿 弹窗壳「环境类失败」）。
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const deletingRef = useRef(false);
  const [importing, setImporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [readingDrop, setReadingDrop] = useState(false);
  const dropPending = useRef(false);
  const [pathValue, setPathValue] = useState("");
  const [pickingPath, setPickingPath] = useState(false);

  /** 导入路径的失败分流：连接类失败改弹浮层（不占界面位置），后端返回的业务错误进
   *  弹窗标题行消息槽（对齐批 45①「反馈分域：已导入→弹窗内」）。弹窗外的面板操作
   *  （启停／预览／文件清单）失败不再有面板提示条承接、改走浮层。 */
  const fail = useCallback((err: unknown): void => {
    const text = reportError(err);
    if (text !== null) setFeedback({ kind: "error", text });
  }, []);

  /** 弹窗外操作的失败分流：连接类由 reportError 弹浮层，业务错误同样进浮层。 */
  const failAside = useCallback((err: unknown): void => {
    const text = reportError(err);
    if (text !== null) toast(text);
  }, []);

  const { skills, loading, loadError, reload: fetchSkills } = useSkills();

  const reload = useCallback(async (): Promise<void> => {
    const list = await fetchSkills();
    // 首次加载默认选中第一个技能（详情区直接有内容；用户可再点选其他）。
    setSelected((current) =>
      current === "" && list.length > 0 ? (list[0]?.id ?? "") : current,
    );
  }, [fetchSkills]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 选中变化 → 拉包文件清单；默认预览 SKILL.md（注入源）。改名后也走这里：包还在、路径没变，
  // 但 frontmatter 被重写过，重读一次才拿得到磁盘上的真基线。
  useEffect(() => {
    setNameDraft(null);
    setHeadMsg(null);
    setSkillMdOriginal("");
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
            if (first.path === "SKILL.md") setSkillMdOriginal(content.content);
          }
        }
      } catch (err) {
        if (!cancelled) {
          failAside(err);
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
  }, [selected, failAside]);

  const current = skills.find((item) => item.id === selected);

  // ---------- 字段即修复（稿 技能详情头「损坏态」）：抢救预填与头行消息槽 ----------
  // 可修复档（frontmatter 坏但 SKILL.md 可读）：名字框 / 描述框显示抢救值（正则从原文捞回，
  // 保存走后端重建 frontmatter 分支）；救不出 → 留空待填、槽提示「无法解析名称/描述」。
  const skillMdRescue = useMemo(
    () => rescueSkillFrontmatter(skillMdOriginal),
    [skillMdOriginal],
  );
  const fixable = current?.damage_kind === "frontmatter-corrupt";
  const nameDefault = fixable ? (skillMdRescue.name ?? "") : (current?.name ?? "");
  const descriptionDefault = fixable
    ? (skillMdRescue.description ?? "")
    : (current?.description ?? "");
  const rescueFailed =
    fixable &&
    skillMdRescue.name === undefined &&
    skillMdRescue.description === undefined;

  // 头行消息槽内容（一槽一消息、互斥替换）：保存被拦（bad）／保存成功（ok）＞ 损坏档常态
  // （warn／bad）。assembly-failed（包体组装失败等）的槽文案稿未承载——不占槽，原因走列表
  // 图标 Tip（挂账呈报）。
  let headNote: {
    kind: "ok" | "warn" | "bad";
    text: string;
    nameBlocked?: boolean;
  } | null = null;
  if (headMsg !== null) {
    headNote = headMsg;
  } else if (current !== undefined) {
    if (current.damage_kind === "frontmatter-corrupt") {
      headNote = rescueFailed
        ? { kind: "warn", text: "无法解析名称/描述" }
        : { kind: "warn", text: "技能包损坏，重新编辑名称和描述后保存即可修复" };
    } else if (current.damage_kind === "not-utf8") {
      headNote = {
        kind: "bad",
        text:
          current.damage_file === "" || current.damage_file === "SKILL.md"
            ? "SKILL.md 不是 UTF-8 编码，请在编辑器中另存为 UTF-8"
            : `${current.damage_file} 不是 UTF-8 编码，请在编辑器中另存为 UTF-8`,
      };
    }
  }

  const pick = (sid: string): void => {
    if (saving || savePending.current) return;
    // dirty 时点其他行：由未保存确认弹窗兜底（dirty 语义改写——动作照常可点）。
    if (dirty) {
      setLeaveAction({ kind: "pick", id: sid });
      setUnsavedError("");
      setUnsavedOpen(true);
      return;
    }
    setSelected(sid);
    setFeedback(null);
  };

  const toggle = async (skill: SkillInfo): Promise<void> => {
    if (togglePending.current) return;
    togglePending.current = true;
    setToggling(true);
    try {
      await api.setSkillEnabled(skill.id, !skill.enabled);
      await reload();
    } catch (err) {
      failAside(err);
    } finally {
      togglePending.current = false;
      setToggling(false);
    }
  };

  /** 导入反馈：损坏行入库（frontmatter 坏不再拒）→ 警告条按来源名指认；正常 → 成功条
   *  （转码注明「N 个文件已从 〈编码〉 转为 UTF-8」，随「导入时归一化」条）。 */
  const applyImportResult = (result: SkillImportResponse, sourceName: string): void => {
    setSelected(result.id);
    if (result.import_error !== null) {
      setFeedback({
        kind: "warn",
        text: `已导入「${sourceName}」，技能名称和描述无法解析，可在技能详情里修复。`,
      });
      return;
    }
    const sizeText = formatBytes(result.total_bytes, "KiB", 1);
    const encodings = [...new Set(result.transcoded.map((t) => t.from_encoding))];
    const transcodeNote =
      result.transcoded.length > 0
        ? `；${result.transcoded.length} 个文件已从 ${encodings.join("、")} 转为 UTF-8`
        : "";
    setFeedback({
      kind: "success",
      text: `已导入「${result.name}」（${sizeText}——skill 全文将注入打标请求，体积偏大时留意 token 消耗${transcodeNote}）`,
    });
  };

  const doImport = async (picked: File[]): Promise<void> => {
    setImporting(true);
    try {
      applyImportResult(await api.importSkillFiles(picked), picked[0]?.name ?? "");
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
      applyImportResult(await api.importSkillFile(picked), picked.name);
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
      applyImportResult(await api.importSkill(path), path.split(/[\\/]/).pop() ?? path);
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
    if (selected === "" || deletingRef.current) {
      return;
    }
    deletingRef.current = true;
    setDeleting(true);
    setDeleteError("");
    try {
      await api.deleteSkill(selected);
      setDeleteDialogOpen(false);
      // 删除成功改浮层提示（对齐批 45③；面板提示条已撤，selected 清空后也不再有槽可落）。
      toast(`已删除「${current?.name ?? selected}」`);
      setSelected("");
      await reload();
    } catch (err) {
      // 业务错误就地进弹窗（弹窗保持打开）；连接类失败 reportError 已改走浮层。
      const text = reportError(err);
      if (text !== null) {
        setDeleteError(text);
      }
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  };

  const openPreview = async (path: string): Promise<void> => {
    if (selected === "" || savePending.current) {
      return;
    }
    // dirty 时点另一枚胶囊：由未保存确认弹窗兜底（稿＝照常可点）。
    if (dirty) {
      setLeaveAction({ kind: "preview", path });
      setUnsavedError("");
      setUnsavedOpen(true);
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
      if (path === "SKILL.md") setSkillMdOriginal(content.content);
      setDescriptionDraft(null);
    } catch (err) {
      if (generation === previewGeneration.current) failAside(err);
    } finally {
      if (generation === previewGeneration.current) setLoadingPreview(false);
    }
  };

  /** 回退未保存修改（「放弃修改」路）：详情回填落盘值。 */
  const revertDraft = (): void => {
    setPreviewContent(originalContent);
    setDescriptionDraft(null);
    setNameDraft(null);
  };

  /** 弹窗放行后的目标动作。 */
  const runLeaveAction = async (
    action: NonNullable<typeof leaveAction>,
  ): Promise<void> => {
    if (action.kind === "pick") {
      setSelected(action.id);
      setFeedback(null);
      return;
    }
    const generation = ++previewGeneration.current;
    setLoadingPreview(true);
    try {
      const content = await api.readSkillFile(selected, action.path);
      if (generation !== previewGeneration.current) return;
      setPreviewPath(action.path);
      setPreviewContent(content.content);
      setOriginalContent(content.content);
      if (action.path === "SKILL.md") setSkillMdOriginal(content.content);
      setDescriptionDraft(null);
    } catch (err) {
      if (generation === previewGeneration.current) failAside(err);
    } finally {
      if (generation === previewGeneration.current) setLoadingPreview(false);
    }
  };

  const confirmLeaveSave = async (): Promise<void> => {
    if (leaveAction === null || unsavedBusy) return;
    const action = leaveAction;
    setUnsavedBusy(true);
    try {
      const result = await save();
      if (!result.ok) {
        if (result.error !== "") setUnsavedError(result.error);
        return;
      }
      setUnsavedOpen(false);
      setUnsavedError("");
      setLeaveAction(null);
      await runLeaveAction(action);
    } finally {
      setUnsavedBusy(false);
    }
  };

  const discardLeave = (): void => {
    if (leaveAction === null || unsavedBusy) return;
    const action = leaveAction;
    revertDraft();
    setUnsavedOpen(false);
    setUnsavedError("");
    setLeaveAction(null);
    void runLeaveAction(action);
  };

  const closeLeave = (open: boolean): void => {
    if (open) return;
    setUnsavedOpen(false);
    setUnsavedError("");
    setLeaveAction(null);
  };

  const save = async (): Promise<{ ok: boolean; error: string }> => {
    if (savePending.current || loadingPreview || !dirty || current === undefined) {
      return { ok: false, error: "" };
    }
    // 名字提交值 = 草稿 ?? 显示默认值（坏包＝抢救值，救不出为空串 → 空名拦截）。
    const nextName = (nameDraft ?? nameDefault).trim();
    if (nextName === "") {
      const message = "名称不能为空；请填写技能名称。";
      setHeadMsg({ kind: "bad", text: message, nameBlocked: true });
      return { ok: false, error: message };
    }
    const renamed = nextName !== current.name;
    savePending.current = true;
    setSaving(true);
    const generation = previewGeneration.current;
    try {
      const result = await api.saveSkillFile(selected, previewPath, {
        content: previewContent,
        original_content: originalContent,
        // 坏包必须带 description（后端靠它走「重建 frontmatter」分支即修复）；健康包
        // 只在改动时带（不吞用户没动过的值）。
        ...(descriptionDraft !== null || fixable
          ? { description: descriptionDraft ?? descriptionDefault }
          : {}),
      });
      if (generation !== previewGeneration.current) {
        return { ok: false, error: "" };
      }
      if (renamed) {
        // 改名排在存内容之后：改名会重写 SKILL.md 的 frontmatter（name 与目录名一起换），
        // 先改名就让刚读到的并发基线失效了（实测 PUT 当场 400）。坏包同路：重建分支
        // 先落标准 frontmatter（name 暂用包 ID），改名接口随后落用户的显示名。
        await api.renameSkill(selected, { new_name: nextName });
      }
      const finalContent =
        renamed && previewPath !== ""
          ? (await api.readSkillFile(selected, previewPath)).content
          : result.content;
      if (generation !== previewGeneration.current) {
        return { ok: false, error: "" };
      }
      // 改名重写了 frontmatter 的 name 字段——显式重读拿磁盘真基线（选中是 ID、不再
      // 变化，原「选中变化触发重读」的机制不再触发）。
      setPreviewContent(finalContent);
      setOriginalContent(finalContent);
      setDescriptionDraft(null);
      setNameDraft(null);
      if (previewPath === "SKILL.md") setSkillMdOriginal(finalContent);
      // 成功句挂详情头行消息槽（--ok；一槽一消息、互斥替换——对齐批「技能侧反馈归一」，
      // E 位对位表「已保存→详情头槽」）。
      setHeadMsg({
        kind: "ok",
        text: renamed ? `已保存并改名为「${nextName}」` : "已保存",
      });
      await reload();
      return { ok: true, error: "" };
    } catch (err) {
      if (generation === previewGeneration.current) {
        // 保存失败同样按分流（稿 技能详情头「保存飞行／预览加载」行）：业务错误进详情头
        // 消息槽、连接类由 reportError 走浮层。
        const text = reportError(err);
        if (text !== null) setHeadMsg({ kind: "bad", text });
        return { ok: false, error: text ?? "" };
      }
      return { ok: false, error: "" };
    } finally {
      savePending.current = false;
      setSaving(false);
    }
  };

  // ---------- 壳层接口：dirty 上报＋保存／回退注册（ref 桥保证壳层拿到最新闭包） ----------
  const actionsRef = useRef<PanelUnsavedActions | null>(null);
  const detailRef = useVscrollColumn<HTMLDivElement>();
  actionsRef.current = {
    save: () => save(),
    revert: revertDraft,
  };
  useEffect(() => {
    onRegisterActions?.({
      save: () =>
        actionsRef.current?.save() ?? Promise.resolve({ ok: false, error: "" }),
      revert: () => actionsRef.current?.revert(),
    });
    return () => onRegisterActions?.(null);
  }, [onRegisterActions]);
  useEffect(() => {
    onSettingsDirtyChange?.(dirty);
  }, [dirty, onSettingsDirtyChange]);
  useEffect(() => () => onSettingsDirtyChange?.(false), [onSettingsDirtyChange]);

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-auto rounded-lg border border-border bg-card shadow-(--sh-1) md:grid md:grid-cols-[280px_minmax(0,1fr)] md:overflow-hidden">
      {/* 左：列表 + 导入 */}
      <SkillList
        skills={skills}
        loading={loading}
        loadError={loadError}
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

      {/* 右：详情 + 包内容预览（列内滚、自绘竖向滚动条；内距 24/32——两子页归一值） */}
      <div
        ref={detailRef}
        className="vscroll-y flex min-w-0 shrink-0 flex-1 flex-col border-t border-border p-4 lg:min-h-0 lg:overflow-y-auto lg:border-t-0 lg:border-l lg:px-8 lg:py-6"
      >
        {current !== undefined ? (
          <SkillDetail
            nameDraft={nameDraft}
            nameDefault={nameDefault}
            onNameChange={(value) => {
              // 改正名字即清「保存被拦」消息（稿：改正后回常态消息）。
              setHeadMsg(null);
              setNameDraft(value === nameDefault ? null : value);
            }}
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
            descriptionDefault={descriptionDefault}
            onDescriptionChange={(value) =>
              setDescriptionDraft(value === descriptionDefault ? null : value)
            }
            headNote={headNote}
            onSave={() => void save()}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-t-sm text-text-3">
            左侧选择一个技能查看详情与包内容。
          </div>
        )}
      </div>

      <UnsavedConfirmDialog
        open={unsavedOpen}
        onOpenChange={closeLeave}
        flight={unsavedBusy}
        error={unsavedError}
        onSave={() => void confirmLeaveSave()}
        onDiscard={discardLeave}
      />

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
        onOpenChange={(value) => {
          setDeleteDialogOpen(value);
          if (!value) {
            setDeleteError("");
          }
        }}
        target={current?.name ?? selected}
        flight={deleting}
        error={deleteError}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
