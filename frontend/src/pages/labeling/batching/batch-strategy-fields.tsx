import { ChevronDownIcon, SettingsIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { EndpointConfigSummary, PromptInfo, SkillInfo } from "../../../api";
import type { components } from "../../../api-types.gen";
import {
  CfgPopCheckRow,
  CfgPopContent,
  CfgPopHead,
  CfgPopRow,
  CfgPopRowMain,
  CfgPopStateRow,
} from "../../../components/cfg-pop";
import { Button } from "../../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { Input } from "../../../components/ui/input";
import { Tip } from "../../../components/ui/tooltip";

type StrategyView = components["schemas"]["StrategyView"];

/** 弹层一行（触发件回显取同一份文字）。 */
interface Option {
  value: string;
  /** 行内名字（弹层那一行显示的那份，也是触发件回显）。 */
  name: string;
  /** 行内第二行（策略来源的「端点 ｜ 提示词 ｜ Skill 数」摘要）。 */
  desc?: string;
  disabled?: boolean;
}

/**
 * 库弹层支的单值选择器（笔②③）：触发件＝§8 `.select` 同构（34px 白底描边、值左箭头右），
 * 弹层＝cfg-pop 族支（头行＝库名＋右端齿轮、不写计数；行＝族行形态，当前行 tint）。
 */
function PopSelect({
  ariaLabel,
  head,
  value,
  options,
  emptyText,
  disabled,
  placeholder = "请选择",
  onSelect,
}: {
  ariaLabel: string;
  /** 弹层头行；null＝无头行（策略来源那枚按稿不带，笔③）。 */
  head: { label: string; manageLabel?: string; onManage?: () => void } | null;
  value: string;
  options: Option[];
  emptyText: string;
  disabled: boolean;
  placeholder?: string;
  onSelect: (value: string) => void;
}) {
  const current = options.find((option) => option.value === value);
  const shown = current?.name ?? placeholder;
  return (
    <DropdownMenu>
      <Tip label={shown}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            aria-label={ariaLabel}
            disabled={disabled}
            // §8 .select：h-lg 34／内距 --s-3／t-md／值档 --text-2，箭头取说明档灰。
            className="h-(--h-lg) min-w-0 flex-1 justify-between px-3 font-normal text-t-md text-text-2"
          >
            <span className="min-w-0 truncate">{shown}</span>
            <ChevronDownIcon className="flex-none text-text-3" />
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <CfgPopContent anchor="trigger">
        {head !== null && (
          <CfgPopHead
            label={head.label}
            action={
              head.onManage !== undefined && head.manageLabel !== undefined
                ? {
                    label: head.manageLabel,
                    icon: <SettingsIcon />,
                    onClick: head.onManage,
                  }
                : null
            }
          />
        )}
        {options.length === 0 ? (
          <CfgPopStateRow>{emptyText}</CfgPopStateRow>
        ) : (
          options.map((option) => (
            <CfgPopRow
              key={option.value}
              current={option.value === value}
              disabled={option.disabled}
              onSelect={() => onSelect(option.value)}
            >
              <CfgPopRowMain name={option.name} desc={option.desc} />
            </CfgPopRow>
          ))
        )}
      </CfgPopContent>
    </DropdownMenu>
  );
}

/** 策略内容三行（§22 .nb-sline：76px 标签列＋触发件吃满剩余宽）。 */
function Sline({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="w-[76px] flex-none text-t-sm text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * 新建批次·策略段（稿 #15b 八格；2026-10-11 重设计轮后「发车段」只剩这里的三行策略内容
 * 与卡尾动线——主钮归「表单头与素材来源」件头行，锁定态撤〔笔⑨〕）。
 *
 * 三行**恒渲染**（2026-10-09 归一补笔）：选了库策略时它们是只读展示（disabled 灰档、
 * 值取来源策略的引用），不再整段消失——切来源前后看得见同一份信息。
 */
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
  onLibraryChange,
  onNameChange,
  onEndpointChange,
  onPromptChange,
  onSelectedSkillsChange,
  onNavigateToSettings,
  onOpenWorkbench,
}: {
  id: string;
  library: string;
  name: string;
  endpoint: string;
  prompt: string;
  /** Skill 选择按 id 存（提交体 skill_ids 吃的就是 id；与新增策略弹窗同一身份键）。 */
  selectedSkills: string[];
  strategies: StrategyView[];
  endpoints: EndpointConfigSummary[];
  prompts: PromptInfo[];
  skills: SkillInfo[];
  busy: boolean;
  onLibraryChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onEndpointChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onSelectedSkillsChange: (updater: (previous: string[]) => string[]) => void;
  /** 端点／Skill 的去处＝设置页对应分区（笔⑥的三处齿轮文案各按去处说）。 */
  onNavigateToSettings?: () => void;
  /** 提示词的去处＝策略页（在那里新建，保存后自动同步回本表单）。 */
  onOpenWorkbench?: () => void;
}) {
  const scratch = library === "scratch";
  const source = strategies.find((entry) => entry.id === library);
  const skillName = (value: string): string =>
    skills.find((entry) => entry.id === value)?.name ?? value;
  // 库应用态的只读取值：id 查得到名字就用名字，查不到退回引用原值（不假装空白）。
  const shownEndpoint = scratch
    ? undefined
    : { value: source?.endpoint_id ?? "", name: source?.endpoint_name ?? "" };
  const shownPrompt = scratch
    ? undefined
    : { value: source?.prompt_id ?? "", name: source?.prompt_name ?? "" };
  const shownSkillIds = scratch ? selectedSkills : (source?.skill_ids ?? []);
  const readOnly = !scratch;
  return (
    <>
      <label
        htmlFor={`${id}-library`}
        className="mb-1 block text-t-md font-medium text-text-1"
      >
        策略来源
      </label>
      <PopSelect
        ariaLabel="策略来源"
        head={null}
        value={library}
        disabled={busy}
        onSelect={onLibraryChange}
        options={[
          {
            value: "scratch",
            name: "从零配置",
            desc: "端点、提示词与 Skill 在下面自己选",
          },
          ...strategies.map((entry) => ({
            value: entry.id,
            name: entry.name,
            // 两行式第二行＝「端点 ｜ 提示词 ｜ Skill 数」摘要（笔③样图第三段写法）；
            // 不可用项给一句真话、行不可点（处置出口＝策略页那条链，见挂起清单波 9 笔④）。
            desc: entry.available
              ? [
                  entry.endpoint_name,
                  entry.prompt_name,
                  `Skill ${entry.skill_ids.length}`,
                ].join(" ｜ ")
              : "引用缺失，暂时不可用 · 点击处理",
            disabled: !entry.available,
          })),
        ]}
        emptyText="还没有可用的策略"
      />
      <label
        htmlFor={`${id}-name`}
        className="mb-1 mt-4 block text-t-md font-medium text-text-1"
      >
        策略名
      </label>
      {/* 策略名随来源回填且仍可改（归一补笔：回填由父层 onLibraryChange 做）。 */}
      <Input
        id={`${id}-name`}
        value={name}
        disabled={busy}
        onChange={(event) => onNameChange(event.currentTarget.value)}
      />
      <div className="mb-1 mt-4 text-t-md font-medium text-text-1">策略内容</div>
      {/* 组卡（§22 .nb-strat-group）＝描边 --r-md＋内距 12/16、无底（2026-10-09 用户裁 C）。 */}
      <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-border px-4 py-3">
        <Sline label="端点配置">
          <PopSelect
            ariaLabel="端点配置"
            head={{
              label: "端点",
              manageLabel: "前往设置 · 端点配置",
              onManage: onNavigateToSettings,
            }}
            value={scratch ? endpoint : (shownEndpoint?.value ?? "")}
            disabled={busy || readOnly}
            options={
              scratch
                ? endpoints.map((entry) => ({
                    value: entry.id,
                    // 单行式（笔③）：名字与模型名同一行文字。
                    name: `${entry.name} · ${entry.model}`,
                  }))
                : [
                    {
                      value: shownEndpoint?.value ?? "",
                      name: shownEndpoint?.name ?? "",
                    },
                  ]
            }
            emptyText="还没有可用的端点配置"
            onSelect={onEndpointChange}
          />
        </Sline>
        <Sline label="基础提示词">
          <PopSelect
            ariaLabel="基础提示词"
            head={{
              label: "提示词",
              manageLabel: "前往策略页新建提示词，保存后自动同步到此处",
              onManage: onOpenWorkbench,
            }}
            value={scratch ? prompt : (shownPrompt?.value ?? "")}
            disabled={busy || readOnly}
            options={
              scratch
                ? prompts.map((entry) => ({ value: entry.id, name: entry.name }))
                : [{ value: shownPrompt?.value ?? "", name: shownPrompt?.name ?? "" }]
            }
            emptyText="还没有可用的基础提示词"
            onSelect={onPromptChange}
          />
        </Sline>
        <Sline label="Skill">
          <SkillPicker
            busy={busy}
            readOnly={readOnly}
            selected={shownSkillIds}
            // 停用候选不列出（笔④「过滤不列」——原「（已停用）」缀与禁用行一起撤）。
            skills={skills.filter((entry) => entry.enabled)}
            text={shownSkillIds.map(skillName).join("、") || "未选"}
            onChange={onSelectedSkillsChange}
            onManage={onNavigateToSettings}
          />
        </Sline>
      </div>
    </>
  );
}

/** Skill 多选（笔⑤）：触发件回显顿号纯文字（胶囊撤）、单行固定＋超宽省略悬停全文；
 *  弹层＝勾选行（点选不关层、无当前行 tint）。 */
function SkillPicker({
  busy,
  readOnly,
  selected,
  skills,
  text,
  onChange,
  onManage,
}: {
  busy: boolean;
  readOnly: boolean;
  selected: string[];
  skills: SkillInfo[];
  text: string;
  onChange: (updater: (previous: string[]) => string[]) => void;
  onManage?: () => void;
}) {
  return (
    <DropdownMenu>
      <Tip label={text}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            aria-label="Skill"
            disabled={busy || readOnly}
            className="h-(--h-lg) min-w-0 flex-1 justify-between px-3 font-normal text-t-md text-text-2"
          >
            <span className="min-w-0 truncate">{text}</span>
            <ChevronDownIcon className="flex-none text-text-3" />
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <CfgPopContent anchor="trigger">
        <CfgPopHead
          label="Skill 库"
          action={
            onManage !== undefined
              ? { label: "前往设置 · 技能", icon: <SettingsIcon />, onClick: onManage }
              : null
          }
        />
        {skills.length === 0 ? (
          <CfgPopStateRow>还没有可用的 Skill</CfgPopStateRow>
        ) : (
          skills.map((entry) => (
            <CfgPopCheckRow
              key={entry.id}
              checked={selected.includes(entry.id)}
              name={entry.name}
              desc={entry.description}
              onCheckedChange={() =>
                onChange((previous) =>
                  previous.includes(entry.id)
                    ? previous.filter((value) => value !== entry.id)
                    : [...previous, entry.id],
                )
              }
            />
          ))
        )}
      </CfgPopContent>
    </DropdownMenu>
  );
}
