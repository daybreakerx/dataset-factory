/**
 * 连接 · 端点配置 · 详情表单（右列）：头行（名字框〔配置名可编辑〕＋删除钮＋头行消息槽
 * ＋保存钮）、四个字段（Base URL / API 格式 / 模型名称 / API 密钥——原「名称」字段行随
 * 头行名字框化整撤）、测试连接行与高级参数折叠区。展示层——草稿状态与命令回调由面板传入。
 */
import { EyeIcon, EyeOffIcon } from "lucide-react";
import type { Dispatch, ReactElement, SetStateAction } from "react";
import { useEffect, useState } from "react";
import type { EndpointConfigSummary, EndpointTestResult } from "../../../api";
import { TrashIcon } from "../../../components/icons";
import { NoteInline } from "../../../components/note-inline";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { Tip } from "../../../components/ui/tooltip";
import type { Feedback } from "../../../lib/feedback";
import type { AdvJsonState, ThinkingMode } from "./adv-params";
import { AdvParamsSection } from "./adv-params-section";
import { TestConnection } from "./test-connection";

/** 一期唯一支持的调用格式；其余选项灰显「暂未支持」，未来补适配器即启用。 */
export const SUPPORTED_API_FORMAT = "openai-chat-completions";

const API_FORMATS: ReadonlyArray<{ value: string; label: string; enabled: boolean }> = [
  { value: SUPPORTED_API_FORMAT, label: "OpenAI Chat Completions", enabled: true },
  { value: "openai-responses", label: "OpenAI Responses（暂未支持）", enabled: false },
  {
    value: "anthropic-messages",
    label: "Anthropic Messages（暂未支持）",
    enabled: false,
  },
];

/** 面板操作反馈 → 头行消息槽四色档（家族语义：成功绿／警告琥珀／失败红）。 */
const FEEDBACK_KIND = {
  success: "ok",
  warn: "warn",
  error: "bad",
} as const;

type ConfigFormProps = {
  creating: boolean;
  /** 当前选中的配置（回填与占位来源；创建态为 undefined）。 */
  current: EndpointConfigSummary | undefined;
  /** 编辑态草稿是否干净（与落盘值一致）——净态保存钮退 ghost 并禁用。 */
  clean: boolean;
  draftName: string;
  onNameInput: (value: string) => void;
  draftBaseUrl: string;
  onBaseUrlInput: (value: string) => void;
  draftFormat: string;
  onFormatChange: (value: string) => void;
  draftModel: string;
  onModelInput: (value: string) => void;
  draftKey: string;
  onKeyInput: (value: string) => void;
  feedback: Feedback | null;
  /** 高级参数保存拦截错误（就地落该区状态行；null＝无）。 */
  advInterceptError: string | null;
  canSave: boolean;
  /** 保存请求飞行期（瞬态）：只失效不换装，不进 disabled 条件。 */
  saving: boolean;
  onSave: () => void;
  onDelete: () => void;
  testing: boolean;
  testResult: EndpointTestResult | null;
  onTest: () => void;
  advOpen: boolean;
  onAdvToggle: () => void;
  advForm: { temperature: string; top_p: string; max_tokens: string };
  onAdvFormField: (key: "temperature" | "top_p" | "max_tokens", value: string) => void;
  advTransport: { timeout_seconds: string; max_retries: string };
  setAdvTransport: Dispatch<
    SetStateAction<{ timeout_seconds: string; max_retries: string }>
  >;
  advJson: string;
  onAdvJsonInput: (value: string) => void;
  advState: AdvJsonState;
  thinking: ThinkingMode;
  onThinkingChange: (mode: ThinkingMode) => void;
  /** 详情头行最左槽：窄屏列表展收的展开钮（对齐批「窄屏列表展收」，面板按窄屏传入；宽屏不传）。 */
  headLeading?: ReactElement;
};

/** 详情表单：编辑 / 创建共用一套草稿；保存与删除等命令由面板执行。 */
export function ConfigForm({
  creating,
  current,
  clean,
  draftName,
  onNameInput,
  draftBaseUrl,
  onBaseUrlInput,
  draftFormat,
  onFormatChange,
  draftModel,
  onModelInput,
  draftKey,
  onKeyInput,
  feedback,
  advInterceptError,
  canSave,
  saving,
  onSave,
  onDelete,
  testing,
  testResult,
  onTest,
  advOpen,
  onAdvToggle,
  advForm,
  onAdvFormField,
  advTransport,
  setAdvTransport,
  advJson,
  onAdvJsonInput,
  advState,
  thinking,
  onThinkingChange,
  headLeading,
}: ConfigFormProps): ReactElement {
  // 密钥明文切换只作用于本次输入：框被清空（保存成功回空、换选中回填、放弃修改）
  // 即复位为隐藏——已存密钥永不回显，切换态不能跨清空残留。
  const [showKey, setShowKey] = useState(false);
  useEffect(() => {
    if (draftKey === "") setShowKey(false);
  }, [draftKey]);
  // 保存钮两态禁用（components/button.md 编辑类保存钮脏态纪律）：净态退 ghost 并禁用
  // （Tip「没有未保存的修改」）；三必填任一为空灰阶禁用（Tip 点名缺什么）——创建态仅后者。
  const cleanDisabled = !creating && clean;
  const saveDisabled = creating ? !canSave : cleanDisabled || !canSave;
  const saveTip = cleanDisabled
    ? "没有未保存的修改"
    : canSave
      ? ""
      : "请填写名称、Base URL 和模型名称";
  // 名称字段级失败（后端 field=name 指认）：名字框挂 aria-invalid 并程序化关联到
  // 本行消息槽（DESIGN.md 七 9；操作级错误不得预设 aria-invalid——ARIA21）。
  const nameInvalid = feedback?.field === "name";
  const headMsgId = "endpoint-head-msg";
  return (
    <div className="flex w-full min-w-0 flex-col gap-3">
      <div className="flex min-h-(--h-lg) items-center gap-2">
        {headLeading}
        <input
          aria-label="配置名称"
          aria-invalid={nameInvalid || undefined}
          aria-describedby={nameInvalid ? headMsgId : undefined}
          value={draftName}
          placeholder={creating ? "新建配置" : undefined}
          onInput={(event) => onNameInput(event.currentTarget.value)}
          className="min-w-24 max-w-[380px] w-fit shrink-[1] basis-auto field-sizing-content -ml-[calc(var(--s-1)+1px)] rounded-md border border-transparent bg-transparent p-1 text-t-xl font-semibold text-foreground hover:border-input focus:border-n-400 focus:outline-none"
        />
        {!creating && (
          <Tip label="删除配置">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="删除配置"
              onClick={onDelete}
              // 静止中性、悬停红底红字（.set-head-del 同款——红色留给悬停提示与确认弹窗）。
              className="hover:bg-bad-ink/12 hover:text-bad-ink"
            >
              <TrashIcon />
            </Button>
          </Tip>
        )}
        {/* 头行消息槽（反馈形态归一·E 位）：落删除钮右侧、保存钮左侧——只收两类，
            ①操作级结果②名称字段级失败（名字框就在本行＝就地）；其它字段／区块的
            失败不上浮到此（高级参数类落该区状态行）。一槽一消息，fill 弹性占满中段、
            单行省略＋截断悬停给全文；role="alert"＝提交后一次性结果的播报档（form.md）。 */}
        {feedback !== null && (
          <NoteInline
            fill
            role="alert"
            kind={FEEDBACK_KIND[feedback.kind]}
            text={feedback.text}
            id={headMsgId}
          />
        )}
        <Tip label={saveTip}>
          <Button
            type="button"
            variant={cleanDisabled ? "ghost" : "default"}
            className="ml-auto"
            disabled={saveDisabled}
            // 保存飞行＝瞬态只失效不换装：外观与就绪态同形、不进 disabled 条件
            //（重入由面板 savingRef 守卫掐住），程序化失效信号与 DialogShell flight 同式。
            aria-disabled={saving || undefined}
            onClick={onSave}
          >
            {creating ? "创建" : "保存"}
          </Button>
        </Tip>
      </div>

      <div className="space-y-1">
        <Label htmlFor="endpoint-base-url">Base URL</Label>
        <Input
          id="endpoint-base-url"
          value={draftBaseUrl}
          placeholder="如 https://api.siliconflow.cn/v1"
          onInput={(event) => onBaseUrlInput(event.currentTarget.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="endpoint-format">API 格式</Label>
        <Select
          value={draftFormat}
          onValueChange={onFormatChange}
          disabled={!creating && current === undefined}
        >
          <SelectTrigger id="endpoint-format">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {API_FORMATS.map((format) => (
              <SelectItem
                key={format.value}
                value={format.value}
                disabled={!format.enabled}
              >
                {format.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="endpoint-model">模型名称</Label>
        <Input
          id="endpoint-model"
          value={draftModel}
          placeholder="如 Qwen/Qwen3.5-4B"
          onInput={(event) => onModelInput(event.currentTarget.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="endpoint-api-key">API 密钥</Label>
        <div className="relative">
          <Input
            id="endpoint-api-key"
            type={showKey ? "text" : "password"}
            value={draftKey}
            placeholder={
              !creating && (current?.has_api_key ?? false)
                ? "留空即沿用已配置密钥"
                : "请输入密钥"
            }
            onInput={(event) => onKeyInput(event.currentTarget.value)}
            className="pr-8"
          />
          {draftKey !== "" && (
            // 内嵌尾随钮（components/form.md「输入框内嵌尾随钮」）：图标示「当前状态」
            //（隐藏态＝斜线眼睛、可见态＝正眼睛）；只切本次输入的明文，已存密钥永不回显；
            // 空框不出钮（避免误读成「能查回已存密钥」）；不写 autocomplete（浏览器
            // 记住并复用密钥是实益）。
            <Tip label={showKey ? "隐藏密钥" : "显示密钥"}>
              <button
                type="button"
                aria-label={showKey ? "隐藏密钥" : "显示密钥"}
                onClick={() => setShowKey((visible) => !visible)}
                className="absolute top-1/2 right-3 flex size-6 -translate-y-1/2 items-center justify-center rounded-xs text-muted-foreground transition-colors hover:bg-accent hover:text-text-1"
              >
                {showKey ? (
                  <EyeIcon className="size-(--icon-md)" />
                ) : (
                  <EyeOffIcon className="size-(--icon-md)" />
                )}
              </button>
            </Tip>
          )}
        </div>
      </div>

      <TestConnection
        testing={testing}
        disabled={draftBaseUrl.trim() === "" || draftModel.trim() === ""}
        result={testResult}
        onTest={onTest}
      />

      <AdvParamsSection
        open={advOpen}
        onToggle={onAdvToggle}
        form={advForm}
        onFormField={onAdvFormField}
        transport={advTransport}
        setTransport={setAdvTransport}
        json={advJson}
        onJsonInput={onAdvJsonInput}
        state={advState}
        interceptError={advInterceptError}
        thinking={thinking}
        onThinkingChange={onThinkingChange}
      />
    </div>
  );
}
