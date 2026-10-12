import { FolderIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { components } from "../../../api-types.gen";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Tip } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";

type ScanPreviewView = components["schemas"]["ScanPreviewView"];

/**
 * 素材来源段的信息区五态（§22 `nb-scaninfo`／`nb-doneinfo`／`nb-warninfo`／`nb-errinfo`／`nb-proginfo`）。
 *
 * 「empty」是常态未扫描那一格（槽在场但不说话，撑住行高与钮位）；一槽一消息、互斥替换。
 */
export type SourceInfo =
  | { kind: "empty" }
  | { kind: "scan"; view: ScanPreviewView }
  | {
      kind: "done";
      verb: "已导入" | "已登记";
      total: number;
      images: number;
      videos: number;
      rejected: number;
    }
  | { kind: "progress"; verb: "正在导入" | "正在登记"; percent: number }
  | { kind: "warn"; text: string }
  | { kind: "error"; text: string };

/** 扫描钮气泡＝支持的素材范围（稿「Tip 内容」行）；「扫描」二字说不出收哪些扩展名与多大体积。 */
const SCAN_TIP =
  "仅支持图片 jpg / jpeg / png / webp / gif 与视频 mp4 / mov / webm / avi / mkv / m4v；图片 ≤ 20 MB、视频 ≤ 100 MB。";

/** 「未导入 N 项（2 个扩展名不支持 · 1 个超出大小上限）」——原因就地内联，按条数从多到少排。 */
function reasonCounts(view: ScanPreviewView): string {
  const counts = new Map<string, number>();
  for (const row of view.unimported) {
    counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([reason, count]) => `${count} 个${reason}`)
    .join(" · ");
}

/** 五类信息行的语义色（§22 nb-*info 一族，只差颜色；几何共用）。 */
const INFO_TONE: Record<SourceInfo["kind"], string> = {
  empty: "",
  scan: "text-text-2",
  done: "text-ok-ink",
  progress: "text-info-ink tabular-nums",
  warn: "text-warn-ink",
  error: "text-bad-ink",
};

function InfoLine({ info }: { info: SourceInfo }) {
  let body: ReactNode = null;
  if (info.kind === "scan") {
    body = (
      <>
        扫描到 <span className="font-medium text-text-1">{info.view.total}</span>{" "}
        项：图片 {info.view.images} · 视频 {info.view.videos}
        {/* 未导入 0 项不缀——「0 项（）」没有可报的东西（推导落，稿样图只画有未导入那两格）。 */}
        {info.view.unimported.length > 0 &&
          `；未导入 ${info.view.unimported.length} 项（${reasonCounts(info.view)}）`}
      </>
    );
  } else if (info.kind === "done") {
    body = (
      <>
        {info.verb} <span className="font-medium">{info.total}</span> 项（图片{" "}
        {info.images} · 视频 {info.videos}）
        {/* 拒收缀（2026-10-09 用户裁「缀」定稿）：有拒收才缀红，无拒收整句纯绿。 */}
        {info.rejected > 0 && (
          <span className="text-bad-ink"> · 拒收 {info.rejected} 项</span>
        )}
      </>
    );
  } else if (info.kind === "progress") {
    body = `${info.verb} · ${info.percent}%`;
  } else if (info.kind === "warn" || info.kind === "error") {
    body = info.text;
  }
  return (
    <span
      data-testid="source-info"
      role={
        info.kind === "progress"
          ? "status"
          : info.kind === "error"
            ? "alert"
            : undefined
      }
      className={cn(
        // 占满中段（§22 nb-*info 的 flex:1）＋单行省略；字号一律 12px（2026-10-09 归一）。
        "min-w-0 flex-1 truncate text-t-sm",
        INFO_TONE[info.kind],
      )}
    >
      {body}
    </span>
  );
}

/** 就地警告只在「还没被扫描信息顶掉」时在场（笔⑪：切档即现、扫描后替换、改来源目录又回显）。 */
function idleInfo(mode: "copy" | "inplace"): SourceInfo {
  return mode === "inplace"
    ? { kind: "warn", text: "直接使用素材目录作为工作目录，删除目录后素材会丢失" }
    : { kind: "empty" };
}

/**
 * 新建批次·素材来源段（稿 #15a：2026-10-09 交互流重设计＋2026-10-11 头行改版）。
 *
 * 形态＝区头「素材」下的三段：来源模式分段（§12 .seg，替掉原先的两张 radio 卡）＋
 * 信息行＋扫描/导入两钮，再下是目录行。这里只呈现与回调，**扫描与导入的时机由父层
 * `NewBatchForm` 管**（2026-10-09 用户裁「导入与发车拆分」：登记＋导入前置到「导入」钮，
 * 「创建批次」只做创建）。
 */
export function BatchSourceFields({
  id,
  mode,
  source,
  path,
  info,
  frozen,
  flight,
  canScan,
  onModeChange,
  onSourceChange,
  onPathChange,
  onPickDirectory,
  onScan,
  onImport,
}: {
  id: string;
  mode: "copy" | "inplace";
  source: string;
  path: string;
  info: SourceInfo;
  /** 完成态冻结（笔⑩）：分段、目录框与两枚选择钮一起锁。 */
  frozen: boolean;
  /** 扫描或导入在飞：两钮「只失效不换装」（aria-disabled＋掐指针，外观不变）。 */
  flight: boolean;
  /** 扫描钮解禁＝扫描目标目录非空（copy 看来源目录、就地看素材目录）。 */
  canScan: boolean;
  onModeChange: (mode: "copy" | "inplace") => void;
  onSourceChange: (value: string) => void;
  onPathChange: (value: string) => void;
  onPickDirectory: (field: "source" | "path") => void;
  onScan: () => void;
  onImport: () => void;
}) {
  const done = info.kind === "done";
  // 扫过一遍才给「导入／登记」出口（稿格 1／2／6／8 只画扫描钮，格 3／7／9 才两钮并列）；
  // 扫描失败也算扫过——原地重试的入口就是那枚重新扫描。
  const scanned =
    info.kind === "scan" || info.kind === "error" || info.kind === "progress";
  const importLabel = mode === "copy" ? "导入" : "登记";
  return (
    <>
      <div className="mb-1 text-t-md font-medium text-text-1">素材来源</div>
      {/* §22 .nb-srcrow：分段（§12 .seg）＋信息行（flex-1 吃满中段）＋行尾扫描/导入钮。
            分段的可访问名走 tablist/tab＋aria-selected——与稿侧 markup 同形，也与
            「导入素材弹窗」「运行日志弹窗」两处 .seg 实装同惯例（同族同写法）。 */}
      <div className="mb-3 flex min-w-0 items-center gap-3">
        <div
          role="tablist"
          aria-label="素材来源模式"
          className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-muted p-0.5"
        >
          {(
            [
              ["copy", "复制导入"],
              ["inplace", "就地采用"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              disabled={frozen}
              className={cn(
                // §12 .seg-item：项高 --h-sm、圆角 --r-sm、内距 --s-3；选中白底浮起 sh-1；
                // 禁用档字色压 n-400＋not-allowed（选中项的白底保留）。
                "h-(--h-sm) rounded-md px-3 text-t-sm disabled:cursor-not-allowed disabled:text-n-400",
                mode === value
                  ? "bg-card font-medium text-text-1 shadow-(--sh-1)"
                  : "text-text-3",
              )}
              onClick={() => onModeChange(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <InfoLine info={info} />
        {!done && (
          <Tip label={SCAN_TIP}>
            <Button
              variant="outline"
              disabled={!canScan}
              aria-disabled={flight || undefined}
              className="aria-disabled:pointer-events-none"
              onClick={onScan}
            >
              {scanned ? "重新扫描" : "扫描"}
            </Button>
          </Tip>
        )}
        {scanned && !done && (
          <Button
            variant="default"
            disabled={!canScan}
            aria-disabled={flight || undefined}
            className="aria-disabled:pointer-events-none"
            onClick={onImport}
          >
            {importLabel}
          </Button>
        )}
      </div>
      {mode === "copy" && (
        <>
          {/* 字段标签用 label 元素挂 htmlFor（§22 .field-label 的形态、可访问名的载体）。 */}
          <label
            htmlFor={`${id}-source`}
            className="mb-1 mt-4 block text-t-md font-medium text-text-1"
          >
            来源目录
          </label>
          <div className="flex gap-2">
            <Input
              id={`${id}-source`}
              value={source}
              placeholder="选择或输入素材所在的目录"
              disabled={frozen}
              onChange={(event) => onSourceChange(event.currentTarget.value)}
            />
            {/* 文字钮自明，不配气泡（笔⑮：两处 Tip 随本条拆）；可访问名仍按行区分——
                同屏两枚「选择目录」读屏与自动化都要分得开（可访问名分工承「运行状态组」⑩）。 */}
            <Button
              type="button"
              variant="outline"
              size="lg"
              aria-label="选择来源目录"
              disabled={frozen}
              onClick={() => onPickDirectory("source")}
            >
              <FolderIcon />
              选择目录
            </Button>
          </div>
        </>
      )}
      <label
        htmlFor={`${id}-path`}
        className="mb-1 mt-4 block text-t-md font-medium text-text-1"
      >
        {/* 就地态只有素材目录这一份，标题收成一个「目录」字（笔⑰）。 */}
        {mode === "copy" ? "工作目录" : "目录"}
      </label>
      <div className="flex gap-2">
        <Input
          id={`${id}-path`}
          value={path}
          placeholder="选择或输入工作目录"
          disabled={frozen}
          onChange={(event) => onPathChange(event.currentTarget.value)}
        />
        <Button
          type="button"
          variant="outline"
          size="lg"
          aria-label={mode === "copy" ? "选择工作目录" : "选择目录"}
          disabled={frozen}
          onClick={() => onPickDirectory("path")}
        >
          <FolderIcon />
          选择目录
        </Button>
      </div>
    </>
  );
}

export { idleInfo };
