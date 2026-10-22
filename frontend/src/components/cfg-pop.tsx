/** 下拉弹层族（cfg-pop）——族级组件：弹层壳、头行、行、三态行与行内图标钮。
 *
 * 族规则住 components/overlay.md、取值对齐 base.css §17；族内四实例（策略库／提示词库／
 * 端点／Skill 库）共用本件，实例只带文案与数据差异。
 * 底层件＝ Radix DropdownMenu（components/ui/dropdown-menu.tsx）——键盘范式（开层落当前项、
 * Tab 关菜单＋焦点移出）与三态轮换随其生效；表单 Select 实例走 select.tsx，同守族规则。
 */

import { ChevronDownIcon, SettingsIcon } from "lucide-react";
import type { ComponentProps, ReactElement, ReactNode, RefObject } from "react";

import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Tip } from "./ui/tooltip";

/**
 * 弹层壳：三段式宽度＋以承载块为准的对位。
 *
 * 宽度＝族三段式（`components/overlay.md`）：下限＝承载块的实测宽（不是触发件本体——名字框
 * 触发件里那枚箭头钮只有 24px）、上限 `min(480, 视口−32)`、内容更宽即撑开、下限压过上限时
 * 以下限为准（CSS 天然如此）。**承载块两型**（`anchor`）：
 * - `"trigger"`——触发件本身就是承载块（chip／加号钮这类）：下限直接取 Radix 的触发件宽
 *   变量（`--radix-dropdown-menu-trigger-width`，随开层实时给出、无测量过期问题）；
 * - `"wrap"`——承载块包住触发件（标题型名字框 `.cfg-wrap` 等价物）：Radix 弹层挂在 body 下、
 *   `100%` 不再指向承载块，故在开层渲染时实测 `wrapRef` 宽、以行内 `min-width` 兑现（这类
 *   实例的开层受控于父级、开层必重渲染，测量即开层时点）。
 *
 * 对位＝贴承载块左缘、侧向 4px（`overlay.md`「方向」）；`"wrap"` 型触发件居中/偏置于承载块时，
 * 用两者实测几何的补偿量把落点校正回承载块的边（`"trigger"` 型两者同位、补偿为零）。
 */
function CfgPopContent({
  anchor = "wrap",
  wrapRef,
  triggerRef,
  align = "start",
  side = "bottom",
  className,
  children,
}: {
  /** 承载块形态：trigger＝触发件即承载块；wrap＝另给承载块（配 wrapRef／triggerRef）。 */
  anchor?: "trigger" | "wrap";
  /** 承载块（`.cfg-wrap` 等价物）：`anchor="wrap"` 时给——弹层宽下限与贴边方向的基准。 */
  wrapRef?: RefObject<HTMLElement | null>;
  /** 触发件本体：`anchor="wrap"` 时给（校正对齐偏差）；不传则对位退化为贴触发件。 */
  triggerRef?: RefObject<HTMLElement | null>;
  align?: "start" | "end" | "center";
  side?: "bottom" | "top" | "left" | "right";
  className?: string;
  children: ReactNode;
}): ReactElement {
  let minWidth: string | undefined;
  let alignOffset = 0;
  let sideOffset = 4;
  if (anchor === "trigger") {
    // Radix 在弹层元素上给出触发件宽变量（实测 DOM 已确认在场），随开层实时、无需测量。
    minWidth = "var(--radix-dropdown-menu-trigger-width)";
  } else {
    const wrap = wrapRef?.current;
    const trigger = triggerRef?.current;
    if (wrap !== null && wrap !== undefined) {
      const wrapRect = wrap.getBoundingClientRect();
      minWidth = `${wrapRect.width}px`;
      if (trigger !== null && trigger !== undefined) {
        const triggerRect = trigger.getBoundingClientRect();
        alignOffset =
          align === "end"
            ? wrapRect.right - triggerRect.right
            : wrapRect.left - triggerRect.left;
        sideOffset =
          4 +
          (side === "top"
            ? triggerRect.top - wrapRect.top
            : wrapRect.bottom - triggerRect.bottom);
      }
    }
  }
  return (
    <DropdownMenuContent
      align={align}
      side={side}
      alignOffset={alignOffset}
      sideOffset={sideOffset}
      className={cn(
        // 族壳配套：影随族档 --sh-3（压过 ui/dropdown-menu 基类的 shadow-md）、三段式宽度。
        "min-w-0 w-max max-w-[min(480px,calc(100vw_-_32px))] shadow-(--sh-3)",
        className,
      )}
      style={minWidth !== undefined ? { minWidth } : undefined}
    >
      {children}
    </DropdownMenuContent>
  );
}

/** 头行（`.cfg-pop-head`）：「库名 · 共 N 条」＋通用动作位（22×22、icon 14、配 Tip）。
 *  计数不可知时（取数中／取数失败）由调用方只传库名，不写假计数（overlay.md 头行条）。 */
function CfgPopHead({
  label,
  action,
}: {
  label: ReactNode;
  action?: {
    /** aria-label；与 tip 同文时可省 tip。 */
    label: string;
    tip?: string;
    icon: ReactElement;
    onClick: () => void;
    /** 持续禁用（如提示词侧锁定）：走灰阶档；瞬态飞行期由调用方走 aria-disabled。 */
    disabled?: boolean;
    /** 瞬态禁用（飞行期）：只失效不换装——外观不变、指针与点击掐掉。 */
    inert?: boolean;
  } | null;
}): ReactElement {
  return (
    <div className="flex items-center gap-2 px-2 py-1">
      <span className="text-t-xs text-text-3">{label}</span>
      {action != null && (
        <Tip label={action.tip ?? action.label}>
          <button
            type="button"
            aria-label={action.label}
            disabled={action.disabled}
            aria-disabled={action.inert === true || undefined}
            onClick={() => {
              if (action.disabled === true || action.inert === true) return;
              action.onClick();
            }}
            className={cn(
              "ml-auto flex size-[22px] flex-none items-center justify-center rounded-md text-text-3 select-none",
              "enabled:hover:bg-accent enabled:hover:text-text-1",
              "disabled:cursor-not-allowed disabled:text-n-400 disabled:bg-transparent",
              "aria-disabled:pointer-events-none",
              "[&_svg]:size-(--icon-md)",
            )}
          >
            {action.icon}
          </button>
        </Tip>
      )}
    </div>
  );
}

/** 行（`.pl-row`）：由 Radix Item 承载——方向键／typeahead／Home·End／Enter 全通、禁用项自动跳过。
 *  四档行态＝当前（tint＋描边＋文字随态）／普通（悬停出浅底 --accent）／坏行（名字与标记见 main）／
 *  瞬态禁用（只失效不换装，不铺灰）。 */
function CfgPopRow({
  current = false,
  bad = false,
  disabled = false,
  onSelect,
  className,
  children,
}: {
  /** 当前行（族「你在这里」的 tint 强调）；Skill 多选变体无当前行语义、不传。 */
  current?: boolean;
  /** 坏行（如「引用缺失」）：名字降色到 text-3（base.css §17 `.pl-row.bad`）。 */
  bad?: boolean;
  /** 瞬态禁用（飞行期）：只失效不换装。 */
  disabled?: boolean;
  /** 选中回调；`event.preventDefault()` 可阻止关层（如锁定拦截的就地提示要留在层内）。 */
  onSelect?: (event: Event) => void;
  className?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <DropdownMenuItem
      data-current={current || undefined}
      // 单值行态（cur／bad 互斥）——避免两条同权重色规则在名字上打架；data-current 只管聚焦落点。
      data-row={current ? "cur" : bad ? "bad" : undefined}
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        "group flex cursor-default items-center gap-1 rounded-md border border-transparent p-2 outline-none select-none",
        current
          ? "border-primary/30 bg-primary/8 dark:bg-primary/22 data-[highlighted]:bg-primary/8 dark:data-[highlighted]:bg-primary/22"
          : "data-[highlighted]:bg-accent",
        // 瞬态禁用不换装（行禁用只发生在飞行期）：压掉 Radix Item 基类的 data-disabled 半透明。
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-100",
        className,
      )}
    >
      {children}
    </DropdownMenuItem>
  );
}

/** 行主体（`.pl-main`）：名字（13px/500）＋字数（11px）＋坏行标记（11px 红）同一行、描述（11px）第二行。
 *  名字与描述单行省略（.pl-name／.pl-desc）；被截断的固定文字悬停给全文（design.md 六）——
 *  收拢在组件一处、全部用例（策略／提示词／端点／Skill 行）受益。调用方传 tip（策略行
 *  出处卡这类键值卡）时不再叠名字／描述气泡（嵌套双气泡），全文职责随卡内容走。 */
function CfgPopRowMain({
  name,
  count,
  badge,
  desc,
  tip,
}: {
  name: ReactNode;
  count?: string;
  badge?: ReactNode;
  desc?: ReactNode;
  tip?: ReactNode;
}): ReactElement {
  const nameTip = tip === undefined && typeof name === "string" ? name : "";
  const descTip = tip === undefined && typeof desc === "string" ? desc : "";
  const main = (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex min-w-0 items-baseline gap-2">
        <Tip label={nameTip}>
          <span className="min-w-0 truncate text-t-md font-medium text-text-2 group-data-[row=cur]:text-primary group-data-[row=bad]:text-text-3">
            {name}
          </span>
        </Tip>
        {count !== undefined && (
          <span className="shrink-0 text-t-xs text-n-500">{count}</span>
        )}
        {badge !== undefined && (
          <span className="shrink-0 text-t-xs text-bad-ink">{badge}</span>
        )}
      </span>
      {desc !== undefined && (
        <Tip label={descTip}>
          <span className="min-w-0 truncate text-t-xs text-n-500 group-data-[row=cur]:text-text-3">
            {desc}
          </span>
        </Tip>
      )}
    </span>
  );
  return tip === undefined ? main : <Tip label={tip}>{main}</Tip>;
}

/** 多选勾选行（族内变体，Skill 库）：行首 `.cb` 复选框＋两行式；勾选即信号、无当前行 tint。
 *  点选不关弹层（onSelect preventDefault）；停用候选由调用方过滤、不画禁用行。 */
function CfgPopCheckRow({
  checked,
  disabled = false,
  onCheckedChange,
  name,
  desc,
}: {
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: () => void;
  name: ReactNode;
  desc?: ReactNode;
}): ReactElement {
  return (
    <DropdownMenuCheckboxItem
      checked={checked}
      disabled={disabled}
      withIndicator={false}
      onSelect={(event) => {
        event.preventDefault();
        onCheckedChange();
      }}
      className={cn(
        "group flex cursor-default items-center gap-1 rounded-md border border-transparent p-2 outline-none select-none",
        "data-[highlighted]:bg-accent",
        // 瞬态禁用不换装（勾选飞行期）：压掉 Radix CheckboxItem 基类的 data-disabled 半透明。
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-100",
      )}
    >
      <input
        type="checkbox"
        className="cb pointer-events-none"
        checked={checked}
        readOnly
        tabIndex={-1}
        aria-hidden="true"
      />
      <CfgPopRowMain name={name} desc={desc} />
    </DropdownMenuCheckboxItem>
  );
}

/** 行尾图标钮（`.pl-ic`）：26×26、静止中性灰、悬停出半透明墨底；危险变体悬停才转红（红不常驻）。
 *  瞬态禁用（`inert`）只失效不换装；持续禁用走灰阶档（压字色 --n-400、底保持透明）。
 *  嵌套在行 Item 内：点击掐掉冒泡（否则会触发整行的选中与关闭）。 */
function CfgPopRowIconButton({
  label,
  tip,
  danger = false,
  disabled = false,
  inert = false,
  icon,
  onClick,
}: {
  /** aria-label（带对象名的完整语义）。 */
  label: string;
  /** 悬停气泡文案；不传＝与 aria-label 同文。 */
  tip?: string;
  danger?: boolean;
  disabled?: boolean;
  inert?: boolean;
  icon: ReactElement;
  onClick: () => void;
}): ReactElement {
  return (
    <Tip label={tip ?? label}>
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        aria-disabled={inert === true || undefined}
        onClick={(event) => {
          event.stopPropagation();
          if (disabled || inert) return;
          onClick();
        }}
        className={cn(
          "flex size-(--h-sm) flex-none items-center justify-center rounded-md text-text-3 select-none",
          danger
            ? "enabled:hover:bg-bad-ink/12 enabled:hover:text-bad-ink"
            : "enabled:hover:bg-accent enabled:hover:text-text-1",
          "disabled:cursor-not-allowed disabled:text-n-400 disabled:bg-transparent",
          "aria-disabled:pointer-events-none",
          "[&_svg]:size-(--icon-md)",
        )}
      >
        {icon}
      </button>
    </Tip>
  );
}

/** 三态行（加载／空／失败）：同一行形态（`.pl-row.muted`）、同一内距，只换文案
 *  （overlay.md「同一行的三态轮换」）；只接非连接类失败（连接类走浮层提示）。 */
function CfgPopStateRow({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="p-2 text-t-sm text-muted-foreground select-none">{children}</div>
  );
}

/** 表单行的标签列（§22 `.nb-sline`＋`.nb-slabel`：76px 标签＋控件吃满剩余）。
 *  两枚选择器与两处实例（新建批次策略段／新增策略弹窗）共用——「同一套类，建类一次两件共用」。 */
function CfgPopFieldRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="w-[76px] flex-none text-t-sm text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

/** 单值选择器的一行（触发件回显取 `name`）。 */
interface CfgPopOption {
  value: string;
  /** 行内名字，也是触发件当前值。 */
  name: string;
  /** 行内第二行（两行式：摘要／描述／去处句）。 */
  desc?: string;
  /** 坏行（引用缺失这类）：名字降色，行不给当前态。 */
  bad?: boolean;
  /** 行名右侧红缀短式（11px，如「引用缺失」）。 */
  badge?: string;
  /** 不可点（坏行／锁定项）：Radix 置 aria-disabled 并跳过键盘落点。 */
  disabled?: boolean;
  /** 坏行的修复出口（2026-10-13 E4）：带它＝行保持可达，点击不选中、唤起调用方的处置
   *  （策略引用缺失行 → 「重新指定」弹窗）；与 disabled 互斥（同时给以 repair 为准）。 */
  repair?: () => void;
}

/** 弹层头行的齿轮位入参（族「不写计数」条：取数中／失败时只给库名，不编假数）。 */
interface CfgPopHeadSpec {
  label: string;
  /** 齿轮的 aria／气泡文案（笔⑥：按去处说，如「前往设置 · 端点配置」）。 */
  manageLabel?: string;
  onManage?: () => void;
}

function PopHead({ head }: { head: CfgPopHeadSpec | null }): ReactElement | null {
  if (head === null) return null;
  return (
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
  );
}

/** `.select` 同构的触发件（§8：h-lg 34／内距 --space-12／t-md／值档 --text-2、箭头取说明档灰、
 *  值单行省略＋悬停全文）。`inert`＝飞行期「只失效不换装」（aria-disabled＋掐指针，外观不变）；
 *  与 `disabled`（原生灰档＝持续不可用）分两档，同一时刻至多一个成立。
 *  宽度用 `w-full`＋默认 shrink（非 `flex-1`）：行内（CfgPopFieldRow）由 shrink 填满标签外剩余、
 *  列内（策略来源这类裸挂在 flex-col 卡里）`w-full` 只吃交叉轴、高度恒由 `h-(--h-lg)` 定——
 *  若用 `flex-1`，在列上下文它改的是主尺寸（flex-basis 0% 顶掉 h-lg），高会塌成内容高（22px 报障）。 */
function PopTrigger({
  ariaLabel,
  text,
  disabled,
  inert = false,
}: {
  ariaLabel: string;
  text: string;
  disabled: boolean;
  inert?: boolean;
}): ReactElement {
  return (
    <Tip label={text}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-label={ariaLabel}
          disabled={disabled}
          aria-disabled={inert || undefined}
          className={cn(
            "h-(--h-lg) w-full min-w-0 justify-between px-3 font-normal text-t-md text-text-2",
            inert && "aria-disabled:pointer-events-none",
          )}
        >
          <span className="min-w-0 truncate">{text}</span>
          <ChevronDownIcon className="flex-none text-text-3" />
        </Button>
      </DropdownMenuTrigger>
    </Tip>
  );
}

/**
 * 表单里的库弹层支单值选择器（§8 `.select` 触发件 × cfg-pop 弹层；族稿「下拉选择器」的表单实例）。
 *
 * 两处同规实例＝新建批次策略段与新增策略弹窗（建类一次两件共用）。形态：弹层宽下限＝触发件实测宽；头行＝库名＋右端
 * 齿轮（**不写计数**）；行＝族行形态，当前行 tint、坏行走 bad 档。
 */
function CfgPopSelect({
  ariaLabel,
  head,
  value,
  options,
  emptyText,
  disabled = false,
  inert = false,
  placeholder = "请选择",
  onReopen,
  onSelect,
}: {
  ariaLabel: string;
  /** 弹层头行；null＝无头行（策略来源那枚按稿不带，笔③）。 */
  head: CfgPopHeadSpec | null;
  value: string;
  options: CfgPopOption[];
  /** 空清单那一行的文案（族句式「还没有可用的 X」）。 */
  emptyText: string;
  disabled?: boolean;
  /** 飞行期只失效不换装（笔⑧：与 `disabled` 的持续禁用分档）。 */
  inert?: boolean;
  placeholder?: string;
  /** 每次开层回调（笔⑦「重开弹层即重拉＝重试」的接线点）。 */
  onReopen?: () => void;
  onSelect: (value: string) => void;
}): ReactElement {
  const current = options.find((option) => option.value === value);
  const shown = current?.name ?? placeholder;
  return (
    <DropdownMenu onOpenChange={(open) => open && onReopen?.()}>
      <PopTrigger
        ariaLabel={ariaLabel}
        text={shown}
        disabled={disabled}
        inert={inert}
      />
      <CfgPopContent anchor="trigger">
        <PopHead head={head} />
        {options.length === 0 ? (
          <CfgPopStateRow>{emptyText}</CfgPopStateRow>
        ) : (
          options.map((option) => (
            <CfgPopRow
              key={option.value}
              current={option.value === value && !option.bad}
              bad={option.bad}
              disabled={option.disabled && option.repair === undefined}
              onSelect={() => {
                // 坏行带修复出口（E4）：不选中（来源不变），其余走默认——关层，
                // 调用方的「重新指定」弹窗接着开（本窗先关的那处由调用方负责）。
                if (option.repair !== undefined) {
                  option.repair();
                  return;
                }
                onSelect(option.value);
              }}
            >
              <CfgPopRowMain
                name={option.name}
                desc={option.desc}
                badge={option.badge}
              />
            </CfgPopRow>
          ))
        )}
      </CfgPopContent>
    </DropdownMenu>
  );
}

/**
 * 库弹层支的多选选择器（Skill 这类「一字段多值」的表单实例）：触发件回显＝顿号拼接的纯文字
 * （胶囊撤，2026-10-09 用户裁）、单行固定＋超宽省略悬停全文；弹层＝勾选行，点选不关层、
 * 无当前行 tint。两处同规实例同上（2026-10-11 用户令「同族两窗同规」）。
 */
function CfgPopMultiSelect({
  ariaLabel,
  head,
  options,
  selected,
  text,
  emptyText,
  disabled = false,
  inert = false,
  onReopen,
  onToggle,
}: {
  ariaLabel: string;
  head: CfgPopHeadSpec | null;
  options: { value: string; name: string; desc?: string; disabled?: boolean }[];
  selected: string[];
  /** 触发件回显由调用方给：库应用态要吃来源快照的名字，不只看眼下的候选。 */
  text: string;
  emptyText: string;
  disabled?: boolean;
  /** 飞行期只失效不换装（笔⑧）。 */
  inert?: boolean;
  /** 每次开层回调（笔⑦「重开弹层即重拉＝重试」的接线点）。 */
  onReopen?: () => void;
  onToggle: (value: string) => void;
}): ReactElement {
  return (
    <DropdownMenu onOpenChange={(open) => open && onReopen?.()}>
      <PopTrigger ariaLabel={ariaLabel} text={text} disabled={disabled} inert={inert} />
      <CfgPopContent anchor="trigger">
        <PopHead head={head} />
        {options.length === 0 ? (
          <CfgPopStateRow>{emptyText}</CfgPopStateRow>
        ) : (
          options.map((option) => (
            <CfgPopCheckRow
              key={option.value}
              checked={selected.includes(option.value)}
              name={option.name}
              desc={option.desc}
              disabled={option.disabled}
              onCheckedChange={() => onToggle(option.value)}
            />
          ))
        )}
      </CfgPopContent>
    </DropdownMenu>
  );
}

/** 库弹层触发件的框内下拉钮（`.wt-name-chev`）：24×24、图标 16、绝对贴名字框右缘 2px。
 *  经 Radix Trigger asChild 注入 props（ref／onClick／aria-expanded 等）——组件须透传。 */
function CfgNameChevron({
  label,
  ...props
}: ComponentProps<"button"> & { label: string }): ReactElement {
  return (
    <Tip label={label}>
      <button
        type="button"
        aria-label={label}
        className={cn(
          "absolute top-1/2 right-0.5 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-text-3",
          "enabled:hover:text-text-1 disabled:cursor-not-allowed disabled:text-n-400",
          "[&_svg]:size-(--icon-md)",
        )}
        {...props}
      >
        <ChevronDownIcon className="size-(--icon-md)" />
      </button>
    </Tip>
  );
}

export {
  CfgNameChevron,
  CfgPopCheckRow,
  CfgPopContent,
  CfgPopFieldRow,
  CfgPopHead,
  CfgPopMultiSelect,
  CfgPopRow,
  CfgPopRowIconButton,
  CfgPopRowMain,
  CfgPopSelect,
  CfgPopStateRow,
};
