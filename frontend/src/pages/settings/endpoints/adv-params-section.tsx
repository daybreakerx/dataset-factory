/** 连接 · 端点配置 · 高级参数折叠区（思考模式 + 模型通用参数表单⇄JSON + 传输参数）。 */
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

/** 折叠区本体：默认收起，展开后三段（思考模式 / 模型通用参数 / 传输参数）。
 *  触发行摘要、思考模式长说明与「模型通用参数」小节题均随裁撤除（对齐批）；
 *  JSON 框归多行正文编辑区族＝.mdwrap＞.md（白底描边壳在外、内部只管排版）。 */
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
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-t-md font-medium transition-colors hover:bg-accent"
      >
        <ChevronDownIcon
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
        高级参数（可选）
      </button>
      {open && (
        <div className="space-y-4 border-t border-border px-3 py-3">
          <div className="flex items-center gap-3">
            <Label htmlFor="adv-thinking" className="shrink-0 text-t-sm font-medium">
              思考模式
            </Label>
            <Select
              value={thinking}
              onValueChange={(value) => onThinkingChange(value as ThinkingMode)}
            >
              <SelectTrigger id="adv-thinking" className="w-40">
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
          <div className="space-y-2">
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
                    placeholder="留空使用端点默认"
                    onInput={(event) => onFormField(key, event.currentTarget.value)}
                  />
                </div>
              ))}
            </div>
            <div className="flex min-h-[112px] overflow-hidden rounded-md border border-input bg-card">
              <textarea
                aria-label="模型通用参数 JSON"
                spellCheck={false}
                className="min-h-0 w-full flex-1 resize-none bg-transparent p-3 font-sans text-t-md leading-(--lh-loose) placeholder:text-n-400 focus-visible:outline-none"
                value={json}
                placeholder={`{
  "temperature": 0.7,
  "top_p": 0.9,
  "max_tokens": 1024,
  "extra_body": { "top_k": 50 }
}`}
                onInput={(event) => onJsonInput(event.currentTarget.value)}
              />
            </div>
            <p
              role="status"
              className={cn(
                "text-t-sm",
                state.kind === "invalid" && "text-destructive",
                state.kind === "ignored" && "text-warn-ink",
                state.kind === "ok" && "text-muted-foreground",
              )}
            >
              {state.text}
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-t-sm font-medium">传输参数</p>
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
                  placeholder="留空 = 120 秒"
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
                  placeholder="留空 = 2 次"
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
