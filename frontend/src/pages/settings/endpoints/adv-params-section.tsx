/** 连接 · 端点配置 · 高级参数折叠区（思考模式 + 模型通用参数表单⇄JSON + 本项目传输参数）。 */
import { ChevronDownIcon } from "lucide-react";
import type { Dispatch, ReactElement, SetStateAction } from "react";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { Textarea } from "../../../components/ui/textarea";
import { cn } from "../../../lib/utils";
import type { AdvJsonState, ThinkingMode } from "./adv-params";

/** 思考模式三态的界面文案与说明（A1：一个开关，对话与跑批共用同一个值）。 */
const THINKING_OPTIONS: ReadonlyArray<{ value: ThinkingMode; label: string }> = [
  { value: "default", label: "跟随模型默认" },
  { value: "on", label: "开启思考" },
  { value: "off", label: "关闭思考" },
];

type AdvParamsSectionProps = {
  open: boolean;
  onToggle: () => void;
  form: { temperature: string; top_p: string; max_tokens: string };
  onFormField: (key: "temperature" | "top_p" | "max_tokens", value: string) => void;
  transport: { timeout_seconds: string; max_retries: string };
  setTransport: Dispatch<
    SetStateAction<{ timeout_seconds: string; max_retries: string }>
  >;
  json: string;
  onJsonInput: (value: string) => void;
  state: AdvJsonState;
  thinking: ThinkingMode;
  onThinkingChange: (mode: ThinkingMode) => void;
};

/** 折叠区本体：默认收起，展开后三段（思考模式 / 模型通用参数 / 传输参数）。 */
export function AdvParamsSection({
  open,
  onToggle,
  form,
  onFormField,
  transport,
  setTransport,
  json,
  onJsonInput,
  state,
  thinking,
  onThinkingChange,
}: AdvParamsSectionProps): ReactElement {
  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-t-md font-medium transition-colors hover:bg-accent"
      >
        <ChevronDownIcon
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
        高级参数（可选）
        <span className="text-t-xs font-normal text-muted-foreground">
          思考模式 / temperature / top_p / max_tokens / 超时 / 重试 / extra_body——留空 =
          端点默认值
        </span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-border px-3 py-3">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Label htmlFor="adv-thinking" className="shrink-0 text-t-sm font-medium">
                思考模式
              </Label>
              <Select
                value={thinking}
                onValueChange={(value) => onThinkingChange(value as ThinkingMode)}
              >
                <SelectTrigger id="adv-thinking" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {THINKING_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-t-xs text-muted-foreground">
              关闭思考可显著加快推理型模型的响应。对话试标与跑批共用这一个值——
              只影响新请求与**新建**的批次；已有批次想换参数，请新建一个批次
              （快照冻结在应用时刻）。开关走 SiliconFlow / DashScope 官方的顶层
              enable_thinking 参数，仅部分模型支持（Qwen3.x、DeepSeek-V3.2+、 GLM、Kimi
              等）；不支持的模型会收到端点 400 报错，拨回「跟随模型
              默认」即可恢复。其他厂商字段（如 reasoning_effort）可直接手写进 下方 JSON
              的 extra_body。
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-t-sm font-medium">
              模型通用参数（JSON，与表单双向同步——可直接从厂商文档粘贴）
            </p>
            <div className="grid grid-cols-3 gap-2">
              {(["temperature", "top_p", "max_tokens"] as const).map((key) => (
                <div key={key} className="space-y-1">
                  <Label
                    htmlFor={`adv-${key}`}
                    className="text-t-xs font-normal text-muted-foreground"
                  >
                    {key}
                  </Label>
                  <Input
                    id={`adv-${key}`}
                    type="number"
                    step={key === "max_tokens" ? "1" : "any"}
                    inputMode={key === "max_tokens" ? "numeric" : "decimal"}
                    value={form[key]}
                    placeholder={
                      key === "max_tokens"
                        ? "留空使用端点默认，或输入正整数（如 1024）"
                        : "留空使用端点默认，或输入 0 以上的数值"
                    }
                    onInput={(event) => onFormField(key, event.currentTarget.value)}
                  />
                </div>
              ))}
            </div>
            <Textarea
              aria-label="模型通用参数 JSON"
              spellCheck={false}
              className="min-h-[110px] text-t-sm"
              value={json}
              placeholder={`{
  "temperature": 0.7,
  "top_p": 0.9,
  "max_tokens": 1024,
  "extra_body": { "top_k": 50 }
}`}
              onInput={(event) => onJsonInput(event.currentTarget.value)}
            />
            <p
              role="status"
              className={cn(
                "text-t-sm",
                state.kind === "invalid" && "text-destructive",
                state.kind === "ignored" && "text-amber-600 dark:text-amber-500",
                state.kind === "ok" && "text-muted-foreground",
              )}
            >
              {state.text}
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-t-sm font-medium">
              本项目传输参数（仅表单，不提供 JSON）
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label
                  htmlFor="adv-timeout"
                  className="text-t-xs font-normal text-muted-foreground"
                >
                  timeout_seconds · 单次请求超时秒数
                </Label>
                <Input
                  id="adv-timeout"
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={transport.timeout_seconds}
                  placeholder="留空 = 120 秒（内置默认）"
                  onInput={(event) => {
                    // 先取值再进更新函数：React 的事件对象在更新器执行时已失效。
                    const value = event.currentTarget.value;
                    setTransport((current) => ({
                      ...current,
                      timeout_seconds: value,
                    }));
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label
                  htmlFor="adv-retries"
                  className="text-t-xs font-normal text-muted-foreground"
                >
                  max_retries · 失败自动重试次数
                </Label>
                <Input
                  id="adv-retries"
                  type="number"
                  step="1"
                  inputMode="numeric"
                  value={transport.max_retries}
                  placeholder="留空 = 2 次（内置默认）"
                  onInput={(event) => {
                    const value = event.currentTarget.value;
                    setTransport((current) => ({
                      ...current,
                      max_retries: value,
                    }));
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
