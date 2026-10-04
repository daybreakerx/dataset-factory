/**
 * 连接 · 端点配置 · 详情表单（右列）：头行（名字框〔配置名可编辑〕＋删除钮＋保存钮）、
 * 四个字段（Base URL / API 格式 / 模型名称 / API 密钥——原「名称」字段行随头行名字框化
 * 整撤）、反馈条、测试连接行与高级参数折叠区。展示层——草稿状态与命令回调由面板传入。
 */
import { LockIcon, Trash2Icon } from "lucide-react";
import type { Dispatch, ReactElement, SetStateAction } from "react";
import type { EndpointConfigSummary, EndpointTestResult } from "../../../api";
import { Alert, AlertDescription } from "../../../components/ui/alert";
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
  canSave: boolean;
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
  canSave,
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
}: ConfigFormProps): ReactElement {
  // 保存钮两态禁用（components/button.md 编辑类保存钮脏态纪律）：净态退 ghost 并禁用
  // （Tip「没有未保存的修改」）；三必填任一为空灰阶禁用（Tip 点名缺什么）——创建态仅后者。
  const cleanDisabled = !creating && clean;
  const saveDisabled = creating ? !canSave : cleanDisabled || !canSave;
  const saveTip = cleanDisabled
    ? "没有未保存的修改"
    : canSave
      ? ""
      : "请填写名称、Base URL 和模型名称";
  return (
    <div className="flex w-full min-w-0 flex-col gap-3">
      <div className="flex min-h-(--h-lg) items-center gap-2">
        <input
          aria-label="配置名称"
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
              <Trash2Icon />
            </Button>
          </Tip>
        )}
        <Tip label={saveTip}>
          <Button
            type="button"
            variant={cleanDisabled ? "ghost" : "default"}
            className="ml-auto"
            disabled={saveDisabled}
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
        <Input
          id="endpoint-api-key"
          type="password"
          value={draftKey}
          placeholder={
            !creating && (current?.has_api_key ?? false)
              ? "留空 = 沿用已配置密钥"
              : "请输入密钥"
          }
          onInput={(event) => onKeyInput(event.currentTarget.value)}
        />
        <p className="flex items-center gap-1.5 text-t-sm text-muted-foreground">
          {(current?.has_api_key ?? draftKey.trim() !== "") && (
            <span className="size-2 rounded-full bg-success" aria-hidden />
          )}
          {(current?.has_api_key ?? false)
            ? "已配置"
            : "未配置——可之后补配，或用环境变量 DSF_API_KEY 兜底"}
        </p>
        <p className="flex items-center gap-1.5 text-t-sm text-muted-foreground">
          <LockIcon className="size-3" /> 密钥写入该配置的 credentials
          文件，界面不回显、接口不返回内容。
        </p>
      </div>

      {feedback !== null && (
        <Alert variant={feedback.kind === "error" ? "destructive" : "success"}>
          <AlertDescription>{feedback.text}</AlertDescription>
        </Alert>
      )}

      <TestConnection
        testing={testing}
        disabled={testing || draftBaseUrl.trim() === "" || draftModel.trim() === ""}
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
        thinking={thinking}
        onThinkingChange={onThinkingChange}
      />
    </div>
  );
}
