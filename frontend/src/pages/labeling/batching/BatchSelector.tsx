import {
  CheckIcon,
  ChevronDownIcon,
  CirclePlayIcon,
  FolderIcon,
  FolderOpenIcon,
  PlusIcon,
  SettingsIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useState } from "react";
import type { components } from "../../../api-types.gen";
import { FormError } from "../../../components/form-error";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import {
  Tip,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";

export interface WorkdirBatches {
  id: string;
  title: string;
  batches: components["schemas"]["BatchView"][];
  /** 工作目录的规范绝对路径——胶囊被截断时靠它做悬停兜底（原型明写的用意）。 */
  path?: string;
  error?: string;
}

export interface BatchSelection {
  workdirId: string;
  batchId: string;
}

interface Props {
  workdirs: readonly WorkdirBatches[];
  value: BatchSelection | null;
  onChange: (value: BatchSelection) => void;
  onSettings?: (wid: string) => void;
  onNewStrategy?: (wid: string) => void;
  /** 当前批次的运行状态（跑批中 / 已完成 / 已中断 / 失败），无运行记录时为 null。 */
  runState?: string | null;
  /** 弹层重拉飞行态：打开重拉期间整层换「正在读取…」行（族加载态条；无旧数据可显）。 */
  loading?: boolean;
  /** 目录清单取数失败（只接非连接类，连接类已转浮层）：弹层换「工作目录读取失败」行。 */
  loadError?: string | null;
  /** 弹层打开回调：父级据此重拉清单（族加载态条「每次打开弹层重拉」）。 */
  onOpen?: () => void;
}

/**
 * 批次运行状态五态图标（规格权威＝零件稿 批次下拉列表.html，规范档 components/marks.md
 * 「状态图标」）：未开始＝灰圆环＋播放三角（run_status 为 null＝新建后从未跑过——仍出图标、
 * 不留空位）／跑批中＝蓝进度环（fill＝已尝试 / 计划）／已完成＝绿对勾／已中断＝灰圆环＋
 * 细竖线／失败＝红警告三角。形状各异＝不靠颜色单独表达（DESIGN.md 七·3）；可访问名走
 * role="img"（读屏给文案、视觉不占文字位）。两档灰分层：未开始 --n-400 ＜ 已中断 --n-500
 * （14px 小图标上 --muted-foreground 看着就是黑）。已中断的竖线是改宽过的自绘几何
 * （lucide CirclePause 原形 x 10/14、y 9~15 在 14px 下太短太挤，不能照抄），与其余图标
 * 同为描边组 stroke-width 2、圆端点。
 */
function RunStateIcon({
  status,
  done,
  total,
}: {
  status: string | null;
  done?: number | null;
  total?: number | null;
}) {
  const running = status === "running" || status === "pending";
  const tone = running
    ? "text-info-ink"
    : status === "completed"
      ? "text-ok-ink"
      : status === "failed"
        ? "text-bad-ink"
        : status === "interrupted"
          ? "text-n-500"
          : "text-n-400";
  const label = running
    ? done != null && total != null
      ? `跑批中 ${done} / ${total}`
      : "跑批中"
    : status === "completed"
      ? "已完成"
      : status === "failed"
        ? "失败"
        : status === "interrupted"
          ? "已中断"
          : "未开始";
  return (
    <span
      className={cn("inline-flex size-3.5 shrink-0 items-center justify-center", tone)}
      role="img"
      aria-label={label}
    >
      {running ? (
        // 进度环：r=6、dasharray 2πr=37.7、整环 rotate(-90°) 起画；fill 随「已尝试/计划」走
        <svg
          viewBox="0 0 16 16"
          className="size-(--icon-sm) -rotate-90"
          aria-hidden="true"
        >
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke="hsl(var(--border))"
            strokeWidth="2"
          />
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="37.7"
            strokeDashoffset={
              done != null && total != null && total > 0
                ? 37.7 * (1 - done / total)
                : 37.7
            }
          />
        </svg>
      ) : status === "interrupted" ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          className="size-(--icon-sm)"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="9" y1="8" x2="9" y2="16" />
          <line x1="15" y1="8" x2="15" y2="16" />
        </svg>
      ) : status === "completed" ? (
        <CheckIcon className="size-(--icon-sm)" aria-hidden="true" />
      ) : status === "failed" ? (
        <TriangleAlertIcon className="size-(--icon-sm)" aria-hidden="true" />
      ) : (
        <CirclePlayIcon className="size-(--icon-sm)" aria-hidden="true" />
      )}
    </span>
  );
}

/** 弹层顶部的三态行（族 .pl-row.muted 同槽：加载／失败／空库同一行位、只换文案）。 */
function MutedRow({ text }: { text: string }) {
  return <p className="px-3 py-2 text-t-sm text-muted-foreground">{text}</p>;
}

/** 目录是分组，只有启用的批次可被选中；切换时一次传递完整身份。 */
export function BatchSelector({
  workdirs,
  value,
  onChange,
  onSettings,
  onNewStrategy,
  runState,
  loading,
  loadError,
  onOpen,
}: Props) {
  const [open, setOpen] = useState(false);
  // 目录折叠（裁⑤按 07 保留）：点目录行折/展（行尾两枚图标钮除外，两钮各走各的动作）；
  // 折叠态不持久化，关层重开＝全部展开（稿「展开 · 目录折叠」行）。
  const [closedDirs, setClosedDirs] = useState<ReadonlySet<string>>(new Set());
  const directory = workdirs.find((entry) => entry.id === value?.workdirId);
  const batch = directory?.batches.find(
    (entry) => entry.id === value?.batchId && entry.active,
  );
  // 全站提示走自研气泡——完整路径悬停可查，不再用原生 title。
  const fullLocation = directory?.path
    ? `${directory.path}${batch ? ` / ${batch.name} · ${batch.id}` : ""}`
    : "";

  const toggleDir = (id: string): void => {
    setClosedDirs((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // 关层即复位折叠态：重开＝全部展开（折叠态不持久化，稿矩阵行）。
        if (!next) setClosedDirs(new Set());
        // 族加载态条：每次打开弹层重拉清单（父级以 revision 触发 hook 重拉）。
        if (next) onOpen?.();
      }}
    >
      {/* 完整路径悬停可查（自研气泡）。Tooltip 在外、DropdownMenuTrigger 在内——
          两个 asChild 触发器链式克隆同一个按钮（PromptWorkbench 同款已验证模式），
          不能用 Tip 包住触发器：Tip 不透传 ref 会把 asChild 链打断、菜单打不开。 */}
      <TooltipProvider delayDuration={320}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="选择工作目录与批次"
                className="flex h-8.5 w-full min-w-0 items-center gap-2 rounded-lg border border-border bg-card px-3 text-foreground hover:bg-accent"
              >
                {/* 两段名字「只缩不涨」＋目录名先让位（截断优先级，2026-10-05 用户裁）：
                    目录名 flex 0 999 auto 对批次名 0 1 auto、保底 2em（静态大保底会把短内容
                    撑出段内空档）；id 独立成段 shrink-0、不带前导「·」，与状态图标、箭头
                    恒完整显示——余量全落箭头之前（ml-auto），四段挨着、谁都不撑开。
                    坑：别把「名＋id」包进 flex 外壳再缩——外壳的 min-width:auto 解析成
                    nowrap 文本的 min-content，会把批次名顶死、整颗钮溢出（实测 39px）。 */}
                <span
                  className={cn(
                    "min-w-[2em] truncate text-left text-t-lg [flex:0_999_auto]",
                    directory ? "font-medium" : "font-normal text-muted-foreground",
                  )}
                >
                  {directory?.title ?? "选择工作目录"}
                </span>
                {batch && (
                  <>
                    <span className="min-w-[2em] truncate text-left text-t-sm text-muted-foreground [flex:0_1_auto]">
                      {batch.name}
                    </span>
                    <span className="shrink-0 text-t-sm text-muted-foreground">
                      {batch.id}
                    </span>
                    <RunStateIcon
                      status={runState ?? null}
                      done={batch.run_done}
                      total={batch.run_total}
                    />
                  </>
                )}
                <ChevronDownIcon className="ml-auto size-(--icon-xs) shrink-0 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{fullLocation}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {/* 弹层宽＝族三段式：不窄于触发件（Radix 触发件宽变量）、内容更宽则撑开（w-max）、
          上限 480（components/overlay.md 族条；cfg-pop 同款先例）。 */}
      <DropdownMenuContent
        align="start"
        className="max-h-80 w-max min-w-(--radix-dropdown-menu-trigger-width) max-w-[min(480px,calc(100vw_-_32px))] overflow-y-auto"
      >
        {loading ? (
          <MutedRow text="正在读取…" />
        ) : loadError ? (
          <MutedRow text={loadError} />
        ) : workdirs.length === 0 ? (
          <MutedRow text="还没有可用的工作目录" />
        ) : (
          workdirs.map((entry) => {
            const active = entry.batches.filter((candidate) => candidate.active);
            const closed = closedDirs.has(entry.id);
            return (
              <fieldset key={entry.id} aria-label={entry.title}>
                {/* 目录组行＝整行触发折叠、只有行尾两枚图标钮除外；悬停出浅底。
                    折叠指示由行首文件夹图标承担（展开 folder-open／折叠 folder，不旋转）。
                    结构＝折叠钮（图标＋名字＋余量）与两枚动作钮并列成行：折叠区是真 button
                    （语义与键盘齐备），又不会出现 button 嵌 button 的非法嵌套；悬停底挂行容器。 */}
                <div className="flex w-full items-center gap-2 rounded-md px-3 py-2 select-none hover:bg-accent">
                  <button
                    type="button"
                    aria-expanded={!closed}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-t-md font-medium"
                    onClick={() => toggleDir(entry.id)}
                  >
                    {closed ? (
                      <FolderIcon className="size-(--icon-sm) shrink-0 text-muted-foreground" />
                    ) : (
                      <FolderOpenIcon className="size-(--icon-sm) shrink-0 text-muted-foreground" />
                    )}
                    <Tip label={entry.title}>
                      <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                    </Tip>
                  </button>
                  {onNewStrategy && (
                    <Tip label="新增策略">
                      <button
                        type="button"
                        disabled={!!entry.error}
                        className="flex size-(--h-sm) shrink-0 items-center justify-center rounded-md hover:bg-accent"
                        aria-label={`新增策略 ${entry.title}`}
                        onClick={() => {
                          setOpen(false);
                          onNewStrategy(entry.id);
                        }}
                      >
                        <PlusIcon className="size-(--icon-sm)" />
                      </button>
                    </Tip>
                  )}
                  {onSettings && (
                    <Tip label="工作目录设置">
                      <button
                        type="button"
                        className="flex size-(--h-sm) shrink-0 items-center justify-center rounded-md hover:bg-accent"
                        aria-label={`工作目录设置 ${entry.title}`}
                        onClick={() => {
                          setOpen(false);
                          onSettings(entry.id);
                        }}
                      >
                        <SettingsIcon className="size-(--icon-sm)" />
                      </button>
                    </Tip>
                  )}
                </div>
                {entry.error && (
                  <FormError className="px-6 py-2 text-t-sm text-bad-ink">
                    {entry.error}
                  </FormError>
                )}
                {!closed && !entry.error && active.length === 0 && (
                  <p className="px-6 py-2 text-t-sm text-muted-foreground">
                    还没有可用的批次
                  </p>
                )}
                {!closed &&
                  active.map((candidate) => {
                    const isCurrent =
                      entry.id === value?.workdirId && candidate.id === value.batchId;
                    return (
                      <DropdownMenuItem
                        key={candidate.id}
                        data-current={isCurrent || undefined}
                        aria-current={isCurrent ? "true" : undefined}
                        onSelect={() => {
                          onChange({ workdirId: entry.id, batchId: candidate.id });
                          setOpen(false);
                        }}
                        className={cn(
                          "ml-3 border-l-2 pl-4 text-t-md [&_svg]:size-(--icon-sm)",
                          // 当前行＝primary 浅底＋左线主色（树形行形态，与族 .pl-row.cur 的
                          // 差异只在左线）；不用勾做标记（tint＋左线＋aria-current 三重信号），
                          // 悬停保持 tint 不换底。
                          isCurrent
                            ? "border-l-primary bg-primary/8 dark:bg-primary/22 data-[highlighted]:bg-primary/8 dark:data-[highlighted]:bg-primary/22"
                            : "border-l-border data-[highlighted]:bg-accent",
                        )}
                      >
                        <Tip label={candidate.name}>
                          <span
                            className={cn(
                              "min-w-0 truncate",
                              isCurrent && "text-text-2",
                            )}
                          >
                            {candidate.name}
                          </span>
                        </Tip>
                        <span className="shrink-0 text-t-sm text-muted-foreground">
                          {candidate.id}
                        </span>
                        <span className="min-w-0 flex-1" />
                        {candidate.run_done !== null &&
                          candidate.run_total !== null && (
                            <span className="shrink-0 text-t-xs text-text-4 tabular-nums">
                              {candidate.run_done} / {candidate.run_total}
                            </span>
                          )}
                        <RunStateIcon
                          status={candidate.run_status ?? null}
                          done={candidate.run_done}
                          total={candidate.run_total}
                        />
                      </DropdownMenuItem>
                    );
                  })}
              </fieldset>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
