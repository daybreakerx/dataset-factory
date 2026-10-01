/** 能力 · 技能 · 左列列表（列表头计数、搜索框、技能行、导入入口）。 */
import { ImportIcon, SearchIcon } from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";
import type { SkillInfo } from "../../../api";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Switch } from "../../../components/ui/switch";
import {
  Tip,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip";
import { formatChars } from "../../../lib/format";

type SkillListProps = {
  /** 有未保存修改或保存中时整列禁用（面板计算）。 */
  disabled: boolean;
  skills: SkillInfo[];
  selected: string;
  toggling: boolean;
  onToggle: (skill: SkillInfo) => void;
  onPick: (name: string) => void;
  onImport: () => void;
};

/** 左列：每行带启停开关、注入字数与描述；顶部搜索框按名称或描述过滤。 */
export function SkillList({
  disabled,
  skills,
  selected,
  toggling,
  onToggle,
  onPick,
  onImport,
}: SkillListProps): ReactElement {
  const [search, setSearch] = useState("");
  const keyword = search.trim().toLowerCase();
  const visible =
    keyword === ""
      ? skills
      : skills.filter(
          (item) =>
            item.name.toLowerCase().includes(keyword) ||
            item.description.toLowerCase().includes(keyword),
        );

  return (
    <fieldset disabled={disabled} className="flex min-w-0 shrink-0 flex-col lg:min-h-0">
      <div className="flex flex-wrap items-center gap-2 px-4 pt-6 pb-2 lg:px-6">
        <h3 className="text-t-sm font-medium text-muted-foreground">技能列表</h3>
        <span className="text-t-sm text-muted-foreground">{skills.length} 个</span>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onImport}>
          <ImportIcon />
          导入 Skill
        </Button>
      </div>
      <div className="relative mx-4 my-2 lg:mx-6">
        <SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="搜索技能"
          placeholder="搜索名称或描述…"
          className="pl-8"
          value={search}
          onInput={(event) => setSearch(event.currentTarget.value)}
        />
      </div>
      <div className="max-h-40 min-h-0 flex-1 space-y-1 overflow-y-auto px-4 pb-3 lg:max-h-none lg:px-6">
        {visible.length === 0 && (
          <p className="px-1 text-t-sm text-muted-foreground">
            {skills.length === 0 ? "Skill 库为空" : "没有匹配的技能"}
          </p>
        )}
        {visible.map((skill) => {
          const active = skill.name === selected;
          return (
            <div
              key={skill.name}
              className={
                "rounded-md px-3 py-2 transition-colors " +
                (active ? "bg-primary/10" : "bg-card hover:bg-accent")
              }
            >
              <div className="flex items-center gap-2">
                <Switch
                  disabled={toggling}
                  checked={skill.enabled}
                  aria-label={`启用 ${skill.name}`}
                  onClick={() => onToggle(skill)}
                />
                <button
                  type="button"
                  onClick={() => onPick(skill.name)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate text-t-md font-medium">
                      {skill.name}
                    </span>
                    <Tip label="注入正文字符数（SKILL.md + references，即打标请求的注入量）">
                      <span className="shrink-0 text-t-sm text-muted-foreground">
                        {formatChars(skill.body_chars)}
                      </span>
                    </Tip>
                  </span>
                  {skill.description === "" ? (
                    <span className="line-clamp-2 text-t-sm text-muted-foreground">
                      （无描述）
                    </span>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        {/* 去掉 block：line-clamp-2 自带 -webkit-box 显示模式与省略号，
                            block 会把它覆盖成普通块级导致截断失效（长下划线词把卡片撑破
                            左栏宽度，2026-09-13 用户反馈）；anywhere 断长词兜底 */}
                        <span
                          className={
                            "line-clamp-2 text-t-sm [overflow-wrap:anywhere] " +
                            (skill.description.startsWith("文件损坏：")
                              ? "text-destructive"
                              : "text-muted-foreground")
                          }
                        >
                          {skill.description}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-80 whitespace-normal leading-relaxed">
                        {skill.description}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </button>
                <span className="sr-only">{skill.enabled ? "已启用" : "已停用"}</span>
              </div>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
