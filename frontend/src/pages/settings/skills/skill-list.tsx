/** 能力 · 技能 · 左列列表（列表头＋导入钮、搜索框、技能行、三态同槽）。 */
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
import { useVscrollColumn } from "../../../components/vscroll";
import { formatChars } from "../../../lib/format";

type SkillListProps = {
  skills: SkillInfo[];
  loading: boolean;
  loadError: boolean;
  selected: string;
  toggling: boolean;
  onToggle: (skill: SkillInfo) => void;
  onPick: (name: string) => void;
  onImport: () => void;
};

/** 左列：每行带启停开关、注入字数与描述；顶部搜索框按名称或描述过滤。
 *  dirty 时整列照常可点——离开动作由未保存确认弹窗兜底（dirty 语义改写，
 *  原「dirty 时整列禁用」拦截退役）。列表结构与端点左列同构（内嵌式：容器 16、
 *  头行 8/12/0、条目区贴容器）；行＝描边环语言、行名 14px。 */
export function SkillList({
  skills,
  loading,
  loadError,
  selected,
  toggling,
  onToggle,
  onPick,
  onImport,
}: SkillListProps): ReactElement {
  const [search, setSearch] = useState("");
  const itemsRef = useVscrollColumn<HTMLDivElement>();
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
    <fieldset className="flex min-w-0 shrink-0 flex-col gap-1 p-4 lg:min-h-0">
      <div className="flex min-h-(--h-lg) flex-wrap items-center gap-2 px-3 pt-2">
        <h3 className="text-t-md font-medium text-text-1">技能列表</h3>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onImport}>
          <ImportIcon />
          导入 Skill
        </Button>
      </div>
      <div className="relative">
        <SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="搜索技能"
          placeholder="搜索名称或描述…"
          className="pl-8"
          value={search}
          onInput={(event) => setSearch(event.currentTarget.value)}
        />
      </div>
      <div
        ref={itemsRef}
        className="vscroll-y flex max-h-40 min-h-0 flex-1 flex-col gap-1 overflow-y-auto pb-4 lg:max-h-none"
      >
        {visible.length === 0 && (
          <div className="px-1 text-center text-t-sm text-text-3">
            {loadError
              ? "技能读取失败"
              : loading
                ? "正在读取…"
                : skills.length === 0
                  ? "Skill 库为空"
                  : "没有匹配的技能"}
          </div>
        )}
        {visible.map((skill) => {
          const active = skill.name === selected;
          return (
            <div
              key={skill.name}
              className={
                "flex items-center gap-2 rounded-md border px-3 py-2 transition-colors " +
                // 描边环语言（随端点行同款）：静止无环 → 悬停 --border 更浅环 → 选中 --input 环。
                (active ? "border-input" : "border-transparent hover:border-border")
              }
            >
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
                  <span className="min-w-0 truncate text-t-lg font-medium text-text-1">
                    {skill.name}
                  </span>
                  <Tip label="注入正文字符数（SKILL.md + references，即打标请求的注入量）">
                    <span className="shrink-0 text-t-sm text-text-4">
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
          );
        })}
      </div>
    </fieldset>
  );
}
