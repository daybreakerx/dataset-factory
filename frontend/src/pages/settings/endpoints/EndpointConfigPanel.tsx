/**
 * 连接 · 端点配置（列表 + 详情双栏）——面板编排层。
 * 草稿与反馈状态、命令回调（保存 / 创建 / 删除 / 测试连接）住这里；
 * 展示块拆在同目录：config-list / config-form（内嵌 test-connection 与高级参数
 * 折叠区）/ delete-dialog；列表查询收拢在 use-endpoint-configs（命令类留调用点）。
 * dirty 离开动作（切行 / 进创建态）由未保存确认弹窗兜底（未保存确认弹窗稿），
 * 壳层切子页的拦截经 onSettingsDirtyChange / onRegisterActions 上提（SettingsPage → App）。
 */

import type { ReactElement } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EndpointConfigSummary, EndpointTestResult } from "../../../api";
import { api } from "../../../api";
import { UnsavedConfirmDialog } from "../../../components/unsaved-confirm-dialog";
import { useVscrollColumn } from "../../../components/vscroll";
import { type Feedback, reportError } from "../../../lib/feedback";
import type { PanelUnsavedActions } from "../../../lib/unsaved-actions";
import {
  type AdvJsonState,
  collectAdvParams,
  formToJson,
  paramsToJson,
  setThinkingInJson,
  syncFormFromJson,
  type ThinkingMode,
  thinkingOfJson,
} from "./adv-params";
import { ConfigForm, SUPPORTED_API_FORMAT } from "./config-form";
import { ConfigList } from "./config-list";
import { DeleteDialog } from "./delete-dialog";
import { useEndpointConfigs } from "./use-endpoint-configs";

/** 离开动作（弹窗放行后继续执行的目标）。 */
type LeaveAction = { kind: "pick"; id: string } | { kind: "create" };

export function EndpointConfigPanel({
  onSettingsDirtyChange,
  onRegisterActions,
}: {
  /** dirty 变化上报（壳层拦设置子侧栏切子页；卸载时上报 false）。 */
  onSettingsDirtyChange?: (dirty: boolean) => void;
  /** 注册保存／回退接口供壳层弹窗三路行为调用；卸载时注销。 */
  onRegisterActions?: (actions: PanelUnsavedActions | null) => void;
}): ReactElement {
  // 选中句柄＝配置 id（兑现「显示名可重名」口径：显示名只用于渲染与文案，
  // 增删改测一律按 id 寻址——对齐批「端点面板改按 ID 寻址」条）。
  const [selected, setSelected] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftBaseUrl, setDraftBaseUrl] = useState("");
  const [draftFormat, setDraftFormat] = useState<string>(SUPPORTED_API_FORMAT);
  const [draftModel, setDraftModel] = useState("");
  const [draftKey, setDraftKey] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  // 删除飞行期与失败行：提交后回包前两钮只失效不换装；业务错误就地进弹窗
  // （弹窗保持打开），连接类失败由 reportError 改走浮层（稿 弹窗壳「环境类失败」）。
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const deletingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [testing, setTesting] = useState(false);
  const testingRef = useRef(false);
  const [testResult, setTestResult] = useState<EndpointTestResult | null>(null);
  // 高级参数区（默认折叠）：模型通用参数（表单 ⇄ JSON）+ 本项目传输参数（仅表单）。
  const [advOpen, setAdvOpen] = useState(false);
  const [advForm, setAdvForm] = useState({
    temperature: "",
    top_p: "",
    max_tokens: "",
  });
  const [advTransport, setAdvTransport] = useState({
    timeout_seconds: "",
    max_retries: "",
  });
  const [advJson, setAdvJson] = useState("{}");
  const [advState, setAdvState] = useState<AdvJsonState>({
    kind: "ok",
    text: "已同步",
  });
  // 思考模式三态（A1 → B 方案一等参数，2026-09-23）：跟着参数 JSON 里的顶层
  // enable_thinking 走——JSON 是唯一事实，三态控件只是它的可视化快捷键（手写
  // reasoning_effort 等其他厂商字段仍走 JSON 的 extra_body）。
  const [thinking, setThinking] = useState<ThinkingMode>("default");
  // ---------- 未保存确认弹窗（面板内离开动作的兜底） ----------
  const [unsavedOpen, setUnsavedOpen] = useState(false);
  const [unsavedError, setUnsavedError] = useState("");
  const [unsavedBusy, setUnsavedBusy] = useState(false);
  const [leaveAction, setLeaveAction] = useState<LeaveAction | null>(null);

  const { endpoints, loading, loadError, reload } = useEndpointConfigs();

  useEffect(() => {
    void reload().then((list) => {
      // 默认选中第一套（无激活机制，不挑「当前使用」的）；句柄取 id。
      setSelected(list[0]?.id ?? "");
    });
  }, [reload]);

  const current = endpoints.find((item) => item.id === selected);

  /** 把详情草稿回填为某套配置的落盘值（高级参数一并）；选中变化与「放弃修改」共用。 */
  const resetDraftFrom = useCallback((config: EndpointConfigSummary): void => {
    setDraftName(config.name);
    setDraftBaseUrl(config.base_url);
    setDraftFormat(config.api_format);
    setDraftModel(config.model);
    setDraftKey("");
    // 高级参数区同样回填落盘值。
    // ?? {} 是运行时防御：契约里 request_params 必填，但「旧后端进程 + 新页面」的
    // 热升级窗口里响应可能没有这个字段（实机白屏事故的根因，2026-09-13）——缺字段
    // 按未设置处理，绝不让详情页崩树。
    const params = config.request_params ?? {};
    const text = (value: number | null | undefined): string =>
      value === null || value === undefined ? "" : String(value);
    setAdvForm({
      temperature: text(params.temperature),
      top_p: text(params.top_p),
      max_tokens: text(params.max_tokens),
    });
    setAdvTransport({
      timeout_seconds: text(params.timeout_seconds),
      max_retries: text(params.max_retries),
    });
    const nextJson = paramsToJson(params);
    setAdvJson(nextJson);
    setThinking(thinkingOfJson(nextJson));
    setAdvState({ kind: "ok", text: "已同步" });
  }, []);

  // 选中变化（或保存后列表刷新）时把详情回填为落盘值；创建态保留空白草稿。
  useEffect(() => {
    if (creating || current === undefined) {
      return;
    }
    resetDraftFrom(current);
    // 高级参数区折叠态复位（换一套配置重新看）。
    setAdvOpen(false);
  }, [
    resetDraftFrom,
    creating,
    current?.name,
    current?.base_url,
    current?.model,
    current?.api_format,
    current,
  ]);

  // dirty：详情草稿与落盘值任一不同（名称／Base URL／模型／API 格式／密钥输入／高级参数）。
  const advParams = current?.request_params ?? {};
  const advText = (value: number | null | undefined): string =>
    value === null || value === undefined ? "" : String(value);
  const dirty =
    current !== undefined &&
    (draftName !== current.name ||
      draftBaseUrl !== current.base_url ||
      draftModel !== current.model ||
      draftFormat !== current.api_format ||
      draftKey.trim() !== "" ||
      advJson !== paramsToJson(advParams) ||
      advTransport.timeout_seconds !== advText(advParams.timeout_seconds) ||
      advTransport.max_retries !== advText(advParams.max_retries));
  // 创建态草稿有输入同样算 dirty（离开即丢）。
  const creatingDirty =
    creating &&
    (draftName !== "" ||
      draftBaseUrl !== "" ||
      draftModel !== "" ||
      draftKey.trim() !== "" ||
      advJson !== "{}" ||
      advTransport.timeout_seconds !== "" ||
      advTransport.max_retries !== "");
  const leaveGuard = dirty || creatingDirty;

  const performPick = (id: string): void => {
    setSelected(id);
    setCreating(false);
    setFeedback(null);
    setTestResult(null);
  };

  const performStartCreate = (): void => {
    setCreating(true);
    setSelected("");
    setDraftName("");
    setDraftBaseUrl("");
    setDraftFormat(SUPPORTED_API_FORMAT);
    setDraftModel("");
    setDraftKey("");
    setAdvForm({ temperature: "", top_p: "", max_tokens: "" });
    setAdvTransport({ timeout_seconds: "", max_retries: "" });
    setAdvJson("{}");
    setThinking("default");
    setAdvState({ kind: "ok", text: "已同步" });
    setAdvOpen(false);
    setFeedback(null);
    setTestResult(null);
  };

  /** 回退未保存修改（「放弃修改」路）：详情回填落盘值；创建态清回空白。 */
  const revertDraft = (): void => {
    if (creating || current === undefined) {
      performStartCreate();
      return;
    }
    resetDraftFrom(current);
    setFeedback(null);
    setTestResult(null);
  };

  /** dirty 时的离开动作：起确认弹窗（保存／放弃后继续）；飞行期静默拦。 */
  const requestLeave = (action: LeaveAction): void => {
    if (saving) return;
    if (!leaveGuard) {
      if (action.kind === "pick") performPick(action.id);
      else performStartCreate();
      return;
    }
    setLeaveAction(action);
    setUnsavedError("");
    setUnsavedOpen(true);
  };

  /** 弹窗放行后的目标动作。 */
  const runLeaveAction = (action: LeaveAction): void => {
    if (action.kind === "pick") performPick(action.id);
    else performStartCreate();
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
      runLeaveAction(action);
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
    runLeaveAction(action);
  };

  const closeLeave = (open: boolean): void => {
    if (open) return;
    setUnsavedOpen(false);
    setUnsavedError("");
    setLeaveAction(null);
  };

  /** 模型通用参数表单输入 → 同步刷新 JSON（标准键取表单值，非标准键从既有 JSON 带走）。 */
  const onAdvFormField = (
    key: "temperature" | "top_p" | "max_tokens",
    value: string,
  ): void => {
    const nextForm = { ...advForm, [key]: value };
    setAdvForm(nextForm);
    setAdvJson(formToJson(nextForm, advJson));
    setAdvState({ kind: "ok", text: "已同步" });
  };

  /** 粘贴 / 编辑 JSON → 同步回表单三键；无效时只改状态提示（不同步、不报错打断）。 */
  const onAdvJsonInput = (value: string): void => {
    setAdvJson(value);
    // 思考三态跟着 JSON 走（JSON 是唯一事实）：手改 enable_thinking 也反映到控件。
    setThinking(thinkingOfJson(value));
    const synced = syncFormFromJson(value);
    if (synced.state.kind !== "invalid") {
      setAdvForm(synced.form);
    }
    setAdvState(synced.state);
  };

  /** 三态选择 → 写进 JSON 的 extra_body（其余透传键原样保留；JSON 无效不动原值）。 */
  const onThinkingChange = (mode: ThinkingMode): void => {
    setThinking(mode);
    const nextJson = setThinkingInJson(advJson, mode);
    if (nextJson === null) {
      setAdvState({ kind: "invalid", text: "JSON 无效——修好后再设置思考模式" });
      return;
    }
    setAdvJson(nextJson);
    setAdvState({ kind: "ok", text: "已同步" });
  };

  const testConnection = async (): Promise<void> => {
    // 键盘路径守卫（data-loading 的 pointer-events 管不到 Enter 重触发）。
    if (testingRef.current) return;
    testingRef.current = true;
    setTesting(true);
    setTestResult(null);
    try {
      // 高级参数一起随探测发出（思考开关带上没有、透传写对没有，后端一并校验）；
      // 本地校验不过就不带参数，仍测连通性。
      const adv = collectAdvParams({
        form: advForm,
        transport: advTransport,
        json: advJson,
      });
      // 身份字段＝id（契约 EndpointTestRequest.id）：显示名可重名，按名寻址已在案退役。
      const result = await api.testEndpoint({
        base_url: draftBaseUrl,
        model: draftModel,
        api_format: draftFormat,
        ...(creating ? {} : { id: selected }),
        ...(draftKey.trim() === "" ? {} : { api_key: draftKey }),
        ...(adv.error === null && Object.keys(adv.params).length > 0
          ? { request_params: adv.params }
          : {}),
      });
      setTestResult(result);
    } catch (err) {
      // 传输层失败先过分流：连接类（network/timeout）走浮层、不落结果字（浮层已承接）；
      // 业务类才落成本行结果字（ok:false）。
      const text = reportError(err);
      if (text !== null) {
        setTestResult({ ok: false, message: text, latency_ms: 0 });
      }
    } finally {
      testingRef.current = false;
      setTesting(false);
    }
  };

  const save = async (): Promise<{ ok: boolean; error: string }> => {
    if (savingRef.current) return { ok: false, error: "" };
    const key = draftKey.trim();
    // 高级参数先本地校验（JSON 语法 / 数值合法性），不过关就拦下——不给后端扔必错的请求。
    const adv = collectAdvParams({
      form: advForm,
      transport: advTransport,
      json: advJson,
    });
    if (adv.error !== null) {
      setFeedback({ kind: "error", text: adv.error });
      return { ok: false, error: adv.error };
    }
    savingRef.current = true;
    setSaving(true);
    try {
      if (creating) {
        const created = await api.createEndpoint({
          name: draftName,
          base_url: draftBaseUrl,
          model: draftModel,
          api_format: draftFormat,
          request_params: adv.params,
          // 密钥可留空：之后可再编辑补配，或用环境变量 DSF_API_KEY 兜底。
          ...(key === "" ? {} : { api_key: key }),
        });
        setFeedback({ kind: "success", text: `已创建配置「${created.name}」` });
        setCreating(false);
        setSelected(created.id);
      } else {
        const nextName = draftName.trim();
        const renamed = current !== undefined && nextName !== current.name;
        const updated = await api.updateEndpoint(selected, {
          base_url: draftBaseUrl,
          model: draftModel,
          api_format: draftFormat,
          request_params: adv.params,
          // 没填新密钥就整个不传：后端沿用该配置已存密钥，不必重输。
          ...(key === "" ? {} : { api_key: key }),
          // 名称有变才带 new_name：改名在后端是目录重命名 + 指针同步。
          ...(renamed ? { new_name: nextName } : {}),
        });
        setFeedback({
          kind: "success",
          text: renamed
            ? `已改名并保存：「${current?.name}」→「${updated.name}」`
            : `已保存「${updated.name}」的更改`,
        });
        // 先把选中切到新 id 再刷新：目录已改名，旧 id 在新列表里已不存在。
        if (renamed) {
          setSelected(updated.id);
        }
      }
      setDraftKey("");
      await reload();
      return { ok: true, error: "" };
    } catch (err) {
      const text = reportError(err);
      if (text !== null) setFeedback({ kind: "error", text });
      return { ok: false, error: text ?? "" };
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (deletingRef.current) {
      return;
    }
    const targetName = current?.name ?? "";
    deletingRef.current = true;
    setDeleting(true);
    setDeleteError("");
    try {
      await api.deleteEndpoint(selected);
      setDeleteDialogOpen(false);
      setFeedback({ kind: "success", text: `已删除配置「${targetName}」` });
      setSelected("");
      await reload();
    } catch (err) {
      // 业务错误就地进弹窗（弹窗保持打开、可改可重试）；连接类失败 reportError
      // 已改走浮层提示（返回 null），不在此重复铺面板反馈。
      const text = reportError(err);
      if (text !== null) {
        setDeleteError(text);
      }
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  };

  const canSave =
    draftName.trim() !== "" && draftBaseUrl.trim() !== "" && draftModel.trim() !== "";

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
    onSettingsDirtyChange?.(leaveGuard);
  }, [leaveGuard, onSettingsDirtyChange]);
  useEffect(() => () => onSettingsDirtyChange?.(false), [onSettingsDirtyChange]);

  return (
    <div className="relative grid h-full min-h-0 grid-cols-[280px_minmax(0,1fr)] overflow-hidden rounded-lg border border-border bg-card shadow-(--sh-1)">
      <ConfigList
        endpoints={endpoints}
        loading={loading}
        loadError={loadError}
        selected={selected}
        onPick={(id) => requestLeave({ kind: "pick", id })}
        onStartCreate={() => requestLeave({ kind: "create" })}
      />

      {/* 右：详情（列内滚、自绘竖向滚动条；内距 24/32——两子页归一值） */}
      <div
        ref={detailRef}
        className="vscroll-y flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto border-l border-border px-8 py-6"
      >
        {creating || current !== undefined ? (
          <ConfigForm
            creating={creating}
            current={current}
            clean={!dirty}
            draftName={draftName}
            onNameInput={setDraftName}
            draftBaseUrl={draftBaseUrl}
            onBaseUrlInput={setDraftBaseUrl}
            draftFormat={draftFormat}
            onFormatChange={setDraftFormat}
            draftModel={draftModel}
            onModelInput={setDraftModel}
            draftKey={draftKey}
            onKeyInput={setDraftKey}
            feedback={feedback}
            canSave={canSave}
            saving={saving}
            onSave={() => void save()}
            onDelete={() => setDeleteDialogOpen(true)}
            testing={testing}
            testResult={testResult}
            onTest={() => void testConnection()}
            advOpen={advOpen}
            onAdvToggle={() => setAdvOpen((open) => !open)}
            advForm={advForm}
            onAdvFormField={onAdvFormField}
            advTransport={advTransport}
            setAdvTransport={setAdvTransport}
            advJson={advJson}
            onAdvJsonInput={onAdvJsonInput}
            advState={advState}
            thinking={thinking}
            onThinkingChange={onThinkingChange}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-t-sm text-text-3">
            左侧选择一套配置，或「添加配置」新建。
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
