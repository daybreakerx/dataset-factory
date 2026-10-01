/** 策略库下拉弹层（区块组件）：切换触发件＋策略列表＋新建／复制／删除入口。 */
import { ChevronDownIcon, CopyIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { type ReactElement, useState } from "react";
import type { EndpointConfigSummary, PromptInfo, SkillInfo } from "../../../api";
import { Button } from "../../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import {
  Tip,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip";
import { formatChars } from "../../../lib/format";
import type { Strategy } from "./use-strategies";

/** 悬停气泡里的出身三参数（components/data.md 键值行：键用弱字、值用次字，键列全站统一 84px）。

    策略存的是各资产的稳定 ID：展示前按传入的资产列表反查显示名；反查不到
    （资产已删除）时显示 ID 原样——缺失本身由 available / missing_refs 表达。
    */
function StrategyRefs({
  entry,
  prompts,
  skills,
  endpoints,
}: {
  entry: Strategy;
  prompts: PromptInfo[];
  skills: SkillInfo[];
  endpoints: EndpointConfigSummary[];
}): ReactElement {
  const endpointName =
    endpoints.find((item) => item.id === entry.endpoint_id)?.name ?? entry.endpoint_id;
  const promptName =
    prompts.find((item) => item.id === entry.prompt_id)?.name ?? entry.prompt_id;
  const skillNames = entry.skill_ids.map(
    (sid) => skills.find((item) => item.id === sid)?.name ?? sid,
  );
  return (
    <span className="grid grid-cols-[84px_minmax(0,1fr)] gap-x-2 gap-y-1 text-left">
      <span className="text-text-4">端点</span>
      <span className="min-w-0 wrap-anywhere text-text-2">{endpointName}</span>
      <span className="text-text-4">提示词</span>
      <span className="min-w-0 wrap-anywhere text-text-2">{promptName}</span>
      <span className="text-text-4">Skill</span>
      <span className="min-w-0 wrap-anywhere text-text-2">
        {skillNames.length === 0 ? "无" : skillNames.join("、")}
      </span>
    </span>
  );
}

export function StrategyMenu({
  open,
  onOpenChange,
  entries,
  selected,
  busy,
  loading,
  locked,
  switchLocked,
  prompts,
  skills,
  endpoints,
  onNew,
  onChoose,
  onCopy,
  onRemove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: Strategy[];
  selected: Strategy | null;
  busy: boolean;
  loading: boolean;
  locked: boolean;
  switchLocked: boolean;
  prompts: PromptInfo[];
  skills: SkillInfo[];
  endpoints: EndpointConfigSummary[];
  onNew: () => void;
  onChoose: (entry: Strategy) => void;
  onCopy: (entry: Strategy) => void;
  onRemove: (entry: Strategy) => void;
}): ReactElement {
  // L9：锁定状态下点了非当前项 → 在列表内给出原因（不弹全局 toast，就地可见）。
  const [switchNotice, setSwitchNotice] = useState<string | null>(null);

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* L9（2026-09-21 审计 / 原型 :1084-1093）：未保存时列表照常打开、
              选中非当前项时才提示——「点不动但看不见有什么」改成「点得动但会告诉你」。 */}
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-0 size-6"
              aria-label="切换策略"
            >
              <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>切换策略</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-96 max-w-[calc(100vw-32px)] p-1">
        {switchNotice !== null && (
          <p
            role="status"
            className="rounded-md bg-warn-bg px-2 py-1.5 text-t-xs text-warn-ink"
          >
            {switchNotice}
          </p>
        )}
        <div className="flex items-center justify-between px-2 py-1 text-t-xs text-text-4">
          <span>策略库 · 共 {entries.length} 条</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="新建策略"
                disabled={busy || loading || locked}
                onClick={onNew}
              >
                <PlusIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>新建策略</TooltipContent>
          </Tooltip>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className={`group flex items-center gap-1 rounded-md p-2 ${selected?.id === entry.id ? "bg-primary/10" : "hover:bg-accent"}`}
            >
              <Tip
                label={
                  <StrategyRefs
                    entry={entry}
                    prompts={prompts}
                    skills={skills}
                    endpoints={endpoints}
                  />
                }
              >
                <span className="min-w-0 flex-1">
                  <button
                    type="button"
                    disabled={busy || loading}
                    className={`w-full min-w-0 text-left ${entry.available ? "text-text-2" : "text-text-4"}`}
                    onClick={() => {
                      if (switchLocked && selected?.id !== entry.id) {
                        // L9：锁着的时候点了要说清为什么（原型 :1093 文案）。
                        setSwitchNotice(
                          "当前有未保存的改动——先点「保存」，才能切换策略。",
                        );
                        return;
                      }
                      setSwitchNotice(null);
                      onChoose(entry);
                    }}
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="block min-w-0 truncate text-t-md font-medium">
                        {entry.name}
                      </span>
                      <span className="shrink-0 text-t-xs text-n-500">
                        {formatChars(entry.body_chars)}
                      </span>
                    </span>
                    <span className="block truncate text-t-xs text-n-500">
                      {entry.description}
                    </span>
                    {!entry.available && (
                      <span className="text-t-xs text-bad-ink">引用缺失</span>
                    )}
                  </button>
                </span>
              </Tip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`复制策略 ${entry.name}`}
                    disabled={busy || loading}
                    onClick={() => onCopy(entry)}
                  >
                    <CopyIcon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>复制</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-bad-ink"
                    aria-label={`删除策略 ${entry.name}`}
                    disabled={busy || loading}
                    onClick={() => onRemove(entry)}
                  >
                    <Trash2Icon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>删除</TooltipContent>
              </Tooltip>
            </div>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
