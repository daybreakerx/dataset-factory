/**
 * 连接 · 端点配置（列表 + 详情双栏）——面板编排层。
 * 草稿与反馈状态、命令回调（保存 / 创建 / 删除 / 激活 / 测试连接）住这里；
 * 展示块拆在同目录：config-list / config-form（内嵌 test-connection 与高级参数
 * 折叠区）/ delete-dialog；列表查询收拢在 use-endpoint-configs（命令类留调用点）。
 */

import type { ReactElement } from "react";
import { useCallback, useEffect, useState } from "react";
import type { EndpointTestResult } from "../../../api";
import { api, errorMessage } from "../../../api";
import { type Feedback, reportError } from "../../../lib/feedback";
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

export function EndpointConfigPanel(): ReactElement {
  const [selected, setSelected] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftBaseUrl, setDraftBaseUrl] = useState("");
  const [draftFormat, setDraftFormat] = useState<string>(SUPPORTED_API_FORMAT);
  const [draftModel, setDraftModel] = useState("");
  const [draftKey, setDraftKey] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [testing, setTesting] = useState(false);
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

  /** 失败分流：连接类失败改弹浮层（不占界面位置），后端返回的业务错误仍就地展示。 */
  const failFeedback = useCallback((err: unknown): void => {
    const text = reportError(err);
    if (text !== null) setFeedback({ kind: "error", text });
  }, []);

  const { endpoints, reload } = useEndpointConfigs(failFeedback);

  useEffect(() => {
    void reload().then((list) => {
      const active = list.find((item) => item.is_active);
      if (active !== undefined) {
        setSelected(active.name);
      }
    });
  }, [reload]);

  const current = endpoints.find((item) => item.name === selected);

  // 选中变化（或保存后列表刷新）时把详情回填为落盘值；创建态保留空白草稿。
  useEffect(() => {
    if (creating || current === undefined) {
      return;
    }
    setDraftName(current.name);
    setDraftBaseUrl(current.base_url);
    setDraftFormat(current.api_format);
    setDraftModel(current.model);
    setDraftKey("");
    // 高级参数区同样回填落盘值；折叠态复位（换一套配置重新看）。
    // ?? {} 是运行时防御：契约里 request_params 必填，但「旧后端进程 + 新页面」的
    // 热升级窗口里响应可能没有这个字段（实机白屏事故的根因，2026-09-13）——缺字段
    // 按未设置处理，绝不让详情页崩树。
    const params = current.request_params ?? {};
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
    setAdvOpen(false);
  }, [
    creating,
    current?.name,
    current?.base_url,
    current?.model,
    current?.api_format,
    current,
  ]);

  const pick = (name: string): void => {
    setSelected(name);
    setCreating(false);
    setFeedback(null);
    setTestResult(null);
  };

  const startCreate = (): void => {
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
    setTesting(true);
    setTestResult(null);
    try {
      // 高级参数一起随探测发出（A1：测试连接回显实际参数——思考开关带上没有、
      // 透传写对没有，一眼可见）；本地校验不过就不带参数，仍测连通性。
      const adv = collectAdvParams({
        form: advForm,
        transport: advTransport,
        json: advJson,
      });
      const result = await api.testEndpoint({
        base_url: draftBaseUrl,
        model: draftModel,
        api_format: draftFormat,
        ...(creating ? {} : { name: selected }),
        ...(draftKey.trim() === "" ? {} : { api_key: draftKey }),
        ...(adv.error === null && Object.keys(adv.params).length > 0
          ? { request_params: adv.params }
          : {}),
      });
      setTestResult(result);
    } catch (err) {
      setTestResult({ ok: false, message: errorMessage(err), latency_ms: 0 });
    } finally {
      setTesting(false);
    }
  };

  const save = async (): Promise<void> => {
    const key = draftKey.trim();
    // 高级参数先本地校验（JSON 语法 / 数值合法性），不过关就拦下——不给后端扔必错的请求。
    const adv = collectAdvParams({
      form: advForm,
      transport: advTransport,
      json: advJson,
    });
    if (adv.error !== null) {
      setFeedback({ kind: "error", text: adv.error });
      return;
    }
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
        setSelected(created.name);
      } else {
        const nextName = draftName.trim();
        const renamed = nextName !== selected;
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
            ? `已改名并保存：「${selected}」→「${updated.name}」`
            : `已保存「${updated.name}」的更改`,
        });
        // 先把选中切到新名再刷新：目录已改名，旧名在新列表里已不存在。
        if (renamed) {
          setSelected(updated.name);
        }
      }
      setDraftKey("");
      await reload();
    } catch (err) {
      failFeedback(err);
    }
  };

  const activate = async (): Promise<void> => {
    try {
      await api.activateEndpoint(selected);
      await reload();
      setFeedback({
        kind: "success",
        text: `已切换当前使用的配置为「${selected}」，对新请求立即生效`,
      });
    } catch (err) {
      failFeedback(err);
    }
  };

  const remove = async (): Promise<void> => {
    try {
      await api.deleteEndpoint(selected);
      setDeleteDialogOpen(false);
      setFeedback({ kind: "success", text: `已删除配置「${selected}」` });
      setSelected("");
      await reload();
    } catch (err) {
      setDeleteDialogOpen(false);
      failFeedback(err);
    }
  };

  const canSave =
    draftName.trim() !== "" && draftBaseUrl.trim() !== "" && draftModel.trim() !== "";

  return (
    <div className="grid h-full min-h-0 grid-cols-[340px_1fr] overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <ConfigList
        endpoints={endpoints}
        selected={selected}
        onPick={pick}
        onStartCreate={startCreate}
      />

      {/* 右：详情 */}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto border-l border-border p-5">
        {creating || current !== undefined ? (
          <ConfigForm
            creating={creating}
            current={current}
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
            onSave={() => void save()}
            onActivate={() => void activate()}
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
          <div className="flex h-full items-center justify-center text-t-md text-muted-foreground">
            左侧选择一套配置，或「添加配置」新建。
          </div>
        )}
      </div>

      <DeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        target={selected}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
