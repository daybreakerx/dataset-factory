/** 策略库下拉弹层（区块组件）：切换触发件＋策略列表＋新建／复制／删除入口。
 *  族内实例——弹层壳／头行／行／三态行住 components/cfg-pop.tsx（对齐批「下拉弹层族
 *  实现侧组件归一」）；实例只带文案与数据差异（族规则 components/overlay.md）。 */
import { CopyIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { type ReactElement, type RefObject, useRef, useState } from "react";
import type { EndpointConfigSummary, PromptInfo, SkillInfo } from "../../../api";
import {
  CfgNameChevron,
  CfgPopContent,
  CfgPopHead,
  CfgPopRow,
  CfgPopRowIconButton,
  CfgPopRowMain,
  CfgPopStateRow,
} from "../../../components/cfg-pop";
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
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
  error,
  locked,
  switchLocked,
  wrapRef,
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
  error: string;
  locked: boolean;
  switchLocked: boolean;
  /** 名字框承载块：弹层宽下限与贴边方向的基准（族宽三段式，见 cfg-pop.tsx）。 */
  wrapRef: RefObject<HTMLDivElement | null>;
  prompts: PromptInfo[];
  skills: SkillInfo[];
  endpoints: EndpointConfigSummary[];
  onNew: () => void;
  onChoose: (entry: Strategy) => void;
  onCopy: (entry: Strategy) => void;
  onRemove: (entry: Strategy) => void;
}): ReactElement {
  // L9：锁定状态下点了非当前项 → 在列表内给出原因（不弹全局 toast，就地可见）。
  // 拦截形态 2026-10-04 已改口径为「确认保存弹窗」（随对齐批施工），本块为过渡形态。
  const [switchNotice, setSwitchNotice] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // 计数不可知（首取中／取数失败）时头行只写库名，不写假计数（overlay.md 头行条）。
  const countKnown = error === "" && !(loading && entries.length === 0);

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        {/* 2026-09-21 定形：未保存时列表照常打开、选中非当前项时才提示——「点不动但看不见
            有什么」改成「点得动但会告诉你」；2026-10-05 随族触发件不再随未保存禁用
            （点非当前行的拦截形态改确认保存弹窗，见对齐批）。 */}
        <CfgNameChevron ref={triggerRef} label="切换策略" />
      </DropdownMenuTrigger>
      <CfgPopContent
        wrapRef={wrapRef}
        triggerRef={triggerRef}
        align="start"
        side="bottom"
      >
        {switchNotice !== null && (
          <div
            role="status"
            className="rounded-md bg-warn-bg px-2 py-1.5 text-t-xs text-warn-ink"
          >
            {switchNotice}
          </div>
        )}
        <CfgPopHead
          label={countKnown ? `策略库 · 共 ${entries.length} 条` : "策略库"}
          action={{
            label: "新建策略",
            // Tip 随态（2026-09-25 定稿；理由随实时保存更新 2026-10-04）：locked＝提示词侧
            // 跨行锁（持续禁用、走灰阶档+Tip）；busy／loading＝瞬态飞行期，只失效不换装、
            // 不配原因 Tip（2026-09-25「飞行期不配原因说明」口径）。
            tip: locked ? "提示词有未保存的改动，请先保存提示词" : "新建策略",
            icon: <PlusIcon />,
            onClick: onNew,
            disabled: locked,
            inert: busy || loading,
          }}
        />
        <div className="max-h-80 overflow-y-auto">
          {loading && entries.length === 0 ? (
            <CfgPopStateRow>正在读取…</CfgPopStateRow>
          ) : error !== "" ? (
            <CfgPopStateRow>策略读取失败</CfgPopStateRow>
          ) : entries.length === 0 ? (
            <CfgPopStateRow>还没有可用的策略</CfgPopStateRow>
          ) : (
            entries.map((entry) => (
              <CfgPopRow
                key={entry.id}
                current={selected?.id === entry.id}
                bad={!entry.available}
                disabled={busy || loading}
                onSelect={(event) => {
                  if (switchLocked && selected?.id !== entry.id) {
                    // L9：锁着的时候点了要说清为什么——就地提示要留在层内
                    // （preventDefault 阻止 Radix 的选中即关层；拦截形态随批 7 改确认保存弹窗）。
                    event.preventDefault();
                    setSwitchNotice("当前有未保存的改动——先点「保存」，才能切换策略。");
                    return;
                  }
                  setSwitchNotice(null);
                  onChoose(entry);
                }}
              >
                <CfgPopRowMain
                  name={entry.name}
                  count={formatChars(entry.body_chars)}
                  badge={entry.available ? undefined : "引用缺失"}
                  desc={entry.description}
                  tip={
                    <StrategyRefs
                      entry={entry}
                      prompts={prompts}
                      skills={skills}
                      endpoints={endpoints}
                    />
                  }
                />
                {entry.available && (
                  <CfgPopRowIconButton
                    label={`复制策略 ${entry.name}`}
                    tip="复制"
                    icon={<CopyIcon />}
                    inert={busy || loading}
                    onClick={() => onCopy(entry)}
                  />
                )}
                <CfgPopRowIconButton
                  danger
                  label={`删除策略 ${entry.name}`}
                  tip="删除"
                  icon={<Trash2Icon />}
                  inert={busy || loading}
                  onClick={() => onRemove(entry)}
                />
              </CfgPopRow>
            ))
          )}
        </div>
      </CfgPopContent>
    </DropdownMenu>
  );
}
