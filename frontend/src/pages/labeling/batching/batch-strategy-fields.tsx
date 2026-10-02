import { SettingsIcon } from "lucide-react";
import type { EndpointConfigSummary, PromptInfo, SkillInfo } from "../../../api";
import type { components } from "../../../api-types.gen";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { Tip } from "../../../components/ui/tooltip";

/** 新建跑批·策略配置段：策略来源、策略名与从零配置段（端点／提示词／Skill）。 */
export function BatchStrategyFields({
  id,
  library,
  name,
  endpoint,
  prompt,
  selectedSkills,
  strategies,
  endpoints,
  prompts,
  skills,
  busy,
  batchLocked,
  onLibraryChange,
  onNameChange,
  onEndpointChange,
  onPromptChange,
  onSelectedSkillsChange,
  onNavigateToSettings,
}: {
  id: string;
  library: string;
  name: string;
  endpoint: string;
  prompt: string;
  selectedSkills: string[];
  strategies: components["schemas"]["StrategyView"][];
  endpoints: EndpointConfigSummary[];
  prompts: PromptInfo[];
  skills: SkillInfo[];
  busy: boolean;
  batchLocked: boolean;
  onLibraryChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onEndpointChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onSelectedSkillsChange: (updater: (previous: string[]) => string[]) => void;
  onNavigateToSettings?: () => void;
}) {
  const picker = (
    label: string,
    value: string,
    change: (value: string) => void,
    options: { value: string; label: string; disabled?: boolean }[],
    options_?: { count?: number; onManage?: () => void },
  ) => (
    <div className="space-y-2">
      {/* 计数头 + 右上角齿轮跳设置——下拉空着的时候，用户看得见「这里有多少
          可选、去哪里加」。 */}
      <div className="flex items-center gap-2">
        <span className="text-t-sm text-muted-foreground">
          {label}
          {options_?.count !== undefined ? ` · 共 ${options_.count} 条` : ""}
        </span>
        {options_?.onManage !== undefined && (
          <Tip label={`管理${label}`}>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`管理${label}`}
              className="ml-auto"
              onClick={options_.onManage}
            >
              <SettingsIcon className="size-3.5" />
            </Button>
          </Tip>
        )}
      </div>
      <Select value={value} onValueChange={change} disabled={busy || batchLocked}>
        <SelectTrigger aria-label={label}>
          <SelectValue placeholder="请选择" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <>
      {picker(
        "策略来源",
        library,
        onLibraryChange,
        [
          { value: "scratch", label: "从零配置" },
          ...strategies.map((entry) => ({
            value: entry.id,
            label: `${entry.name}${entry.available ? "" : " · 引用缺失"}`,
            disabled: !entry.available,
          })),
        ],
        { count: strategies.length },
      )}
      <div className="space-y-2">
        <label htmlFor={`${id}-name`}>策略名</label>
        <Input
          id={`${id}-name`}
          value={name}
          disabled={busy || batchLocked}
          onChange={(event) => onNameChange(event.currentTarget.value)}
        />
      </div>
      {library === "scratch" && (
        <>
          {picker(
            "端点配置",
            endpoint,
            onEndpointChange,
            endpoints.map((entry) => ({
              value: entry.id,
              label: `${entry.name} · ${entry.model}`,
            })),
            {
              count: endpoints.length,
              onManage: onNavigateToSettings,
            },
          )}
          {picker(
            "基础提示词",
            prompt,
            onPromptChange,
            prompts.map((entry) => ({
              value: entry.id,
              label: `${entry.name} · ${entry.description}`,
            })),
            { count: prompts.length, onManage: onNavigateToSettings },
          )}
          <fieldset disabled={busy || batchLocked} className="space-y-2">
            <div className="flex items-center gap-2">
              <legend className="text-t-sm text-muted-foreground">
                Skill · 共 {skills.length} 条
              </legend>
              {onNavigateToSettings !== undefined && (
                <Tip label="管理 Skill">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="管理 Skill"
                    className="ml-auto"
                    onClick={onNavigateToSettings}
                  >
                    <SettingsIcon className="size-3.5" />
                  </Button>
                </Tip>
              )}
            </div>
            {skills.map((skill) => (
              <label key={skill.name} className="flex items-center gap-2 text-t-sm">
                <input
                  type="checkbox"
                  className="cb"
                  disabled={!skill.enabled}
                  checked={selectedSkills.includes(skill.id)}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    onSelectedSkillsChange((previous) =>
                      checked
                        ? [...previous, skill.name]
                        : previous.filter((name) => name !== skill.name),
                    );
                  }}
                />
                {skill.name}
                {!skill.enabled && (
                  <span className="text-t-xs text-text-4">（已停用）</span>
                )}
              </label>
            ))}
          </fieldset>
        </>
      )}
    </>
  );
}
