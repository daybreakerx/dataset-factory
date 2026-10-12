import { CheckIcon, CopyIcon, XIcon } from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../api";
import type { components } from "../../../api-types.gen";
import { FormError } from "../../../components/form-error";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Tip } from "../../../components/ui/tooltip";
import { reportError } from "../../../lib/feedback";
import { cn } from "../../../lib/utils";

type Snapshot = components["schemas"]["BatchSnapshotView"];

/** 分段控件的一段（笔①：段数浮动＝配置名＋提示词名＋每枚 Skill 名，段文案是具体名字）。 */
type Segment = { id: string; label: string };

/** 键值行的标签（稿 .lb-snap-kvr dt）：内部参数键换可读名，白名单外的键（含透传键）原样展示。
 *  api_format／base_url 随行平铺（笔⑥：「高级信息」折叠区退役），标签按稿「中文＋键名」同档。 */
const PARAM_LABELS: Record<string, string> = {
  temperature: "温度 temperature",
  top_p: "多样性 top_p",
  max_tokens: "输出上限 max_tokens",
  enable_thinking: "思考模式 enable_thinking",
  timeout_seconds: "超时（秒）",
  max_retries: "自动重试",
  extra_body: "透传参数 extra_body",
  api_format: "接口格式 api_format",
  base_url: "端点地址 base_url",
};

/** 快照被手动修改的常驻警告句（笔③把它从正文提示条挪到标题行右侧，笔⑬换精简版）。 */
const CHANGE_NOTE = "快照可能被手动修改，后续跑批将使用当前快照。";

/** 复制反馈的复位时长（笔⑭：换装 1.5s 后回原形）。 */
const COPY_RESET_MS = 1_500;

function readableParam(key: string): string {
  return PARAM_LABELS[key] ?? key;
}

/** 64 位哈希截成「前 4…后 4」（笔⑲，全文进悬停气泡）。 */
function shortHash(hash: string): string {
  return hash.length <= 12 ? hash : `${hash.slice(0, 4)}…${hash.slice(-4)}`;
}

/** 视图头行（稿 `.lb-snap-viewhead`）：左侧标签或文件路径，右侧该内容的 sha256（笔④）。 */
function ViewHead({ label, hash }: { label: string; hash: string }): ReactElement {
  return (
    <p className="mb-2 flex min-w-0 items-center gap-2 text-t-xs tabular-nums text-muted-foreground">
      <Tip label={label}>
        <span className="block max-w-[min(60%,420px)] truncate">{label}</span>
      </Tip>
      <Tip label={`sha256 ${hash}`}>
        <span className="ml-auto flex-none cursor-help">{`sha256 ${shortHash(hash)}`}</span>
      </Tip>
    </p>
  );
}

/** 正文块（稿 `.lb-snap-pre`）：无底无边纯文本（笔⑦），折行与滚动由内容区承担（笔⑧）。 */
function Body({ text }: { text: string }): ReactElement {
  return (
    <pre className="break-anywhere whitespace-pre-wrap font-sans text-t-sm leading-[1.7] text-text-1">
      {text}
    </pre>
  );
}

/**
 * 策略快照弹窗（稿 #17，9 格；680 档壳实例）。
 *
 * 布局语言（2026-10-09 用户裁）＝**分段控件切视图**：段数浮动＝配置名＋提示词名＋每枚 Skill 名，
 * 下面是一块**固定高 340 的内容区**（切段只换内容、窗高恒定），三分区堆叠那套退役（笔①②）。
 * Skill 视图内再按**文件**切（笔⑱）：快照把包内每份文本文件各冻一份（后端 #17 C 节），
 * 点胶囊看该文件全文，视图头行的哈希随文件换。
 * 读取中与失败两段都**不出分段控件**（笔⑫），失败就地给「重新读取」；环境类失败（连不上／超时）
 * 走浮层提示、不占界面位置（笔⑪）。
 */
export function SnapshotDialog({
  wid,
  batch,
  onClose,
}: {
  wid: string;
  batch: string;
  onClose: () => void;
}): ReactElement {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState(0);
  const [filePath, setFilePath] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "ok" | "fail">("idle");
  // 每次读取一个令牌：换批次／重读后，上一次的回包作废（迟到结果不覆盖新值）。
  const generation = useRef<object | null>(null);
  const resetTimer = useRef<number | undefined>(undefined);

  function load(): void {
    const token = {};
    generation.current = token;
    setError("");
    setSnapshot(null);
    setCopyState("idle");
    window.clearTimeout(resetTimer.current);
    api.getBatchSnapshot(wid, batch).then(
      (value) => {
        if (generation.current === token) setSnapshot(value);
      },
      (reason: unknown) => {
        // 环境类失败由 reportError 转浮层，这里拿到 null＝不占就地位置（笔⑪）。
        if (generation.current === token) setError(reportError(reason) ?? "");
      },
    );
  }

  // 开窗读一次（本件不轮询、不跟随跑批刷新——「重开看新值」）；「重新读取」钮直接再调它。
  const loadOnce = useCallback(load, [wid, batch]);

  useEffect(() => {
    loadOnce();
    return () => {
      generation.current = null;
      window.clearTimeout(resetTimer.current);
    };
  }, [loadOnce]);

  const skills = snapshot?.skills ?? [];
  const segments: Segment[] = snapshot
    ? [
        { id: "endpoint", label: snapshot.endpoint.name },
        { id: "prompt", label: snapshot.prompt.name },
        ...skills.map((entry, position) => ({
          id: `skill-${position}`,
          label: entry.name,
        })),
      ]
    : [];
  const index = Math.min(tab, Math.max(segments.length - 1, 0));
  const skill = index >= 2 ? skills[index - 2] : undefined;
  const shownFile =
    skill?.files.find((file) => file.path === filePath) ?? skill?.files[0];

  async function copy(): Promise<void> {
    if (snapshot === null) return;
    const token = generation.current;
    let ok = true;
    try {
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
    } catch {
      ok = false;
    }
    if (token === null || generation.current !== token) return;
    setCopyState(ok ? "ok" : "fail");
    window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => {
      if (generation.current === token) setCopyState("idle");
    }, COPY_RESET_MS);
  }

  const copyLabel =
    copyState === "ok"
      ? "已复制"
      : copyState === "fail"
        ? "复制失败，请检查剪贴板权限"
        : "复制快照";
  const copyTip =
    copyState === "idle" && snapshot === null
      ? error !== ""
        ? "读取失败，请先重新读取"
        : "正在读取快照"
      : copyLabel;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/* 窗高恒定：正文不再整窗滚（笔①——长内容由 340 内容区吸收）。 */}
      <DialogContent className="w-[min(var(--w-modal-680),100%)]">
        <DialogHeader className="flex-row items-center gap-3 space-y-0">
          <DialogTitle className="flex-none">策略快照</DialogTitle>
          {/* 副题＝批次身份，恒单行省略＋悬停全文（笔⑩）；警告行在场时它收成内容宽（稿 .modal-head:has 规则）。 */}
          <Tip label={`批次 ${batch}`}>
            <span
              className={cn(
                "min-w-0 truncate text-t-sm text-muted-foreground",
                snapshot?.changed === true ? "flex-none max-w-[38%]" : "flex-1",
              )}
            >
              {batch}
            </span>
          </Tip>
          {/* 警告行落标题行右侧（笔③＝稿 .lb-snap-warnhead，warn 档）：自带底色块与
              role="alert" 一并撤——它是常驻状态说明，不是当场要处理的播报。 */}
          {snapshot?.changed === true && (
            <Tip label={CHANGE_NOTE}>
              <span className="min-w-0 flex-1 truncate text-t-sm text-warn-ink">
                {CHANGE_NOTE}
              </span>
            </Tip>
          )}
        </DialogHeader>
        {snapshot !== null && (
          <div
            role="tablist"
            aria-label="快照内容"
            className="mb-4 flex min-w-0 max-w-full items-center gap-0.5 rounded-md bg-muted p-0.5"
          >
            {segments.map((segment, position) => (
              // 分段的可访问名走 tablist/tab＋aria-selected——与稿侧 markup 同形，
              // 也与「素材来源」「运行日志弹窗」两处 .seg 实装同惯例（同族同写法）。
              <button
                aria-selected={position === index}
                className={cn(
                  // §12 .seg-item：项高 --h-sm、圆角 --r-sm、内距 --s-3；选中白底浮起 sh-1；
                  // 段文案是具体名字，超宽在 140 上限处省略（稿 .lb-snap-segrow .seg-item）。
                  "h-(--h-sm) min-w-0 max-w-[140px] rounded-md px-3 text-t-sm",
                  position === index
                    ? "bg-card font-medium text-text-1 shadow-(--sh-1)"
                    : "text-text-3",
                )}
                key={segment.id}
                onClick={() => {
                  setTab(position);
                  setFilePath("");
                }}
                role="tab"
                type="button"
              >
                <span className="block truncate">{segment.label}</span>
              </button>
            ))}
          </div>
        )}
        {/* 内容区（稿 .lb-snap-body）：固定高 340、内滚、描边 r-sm、白底——正文块自身的底与
            分隔线撤除后，容器边界由这里承担（笔①⑦⑧）。 */}
        <div className="h-[340px] min-w-0 overflow-auto rounded-md border border-border bg-card px-4 py-2">
          {error !== "" && (
            <div className="flex items-center gap-2">
              <FormError className="text-bad-ink">{error}</FormError>
              <Button onClick={() => load()} size="sm" variant="ghost">
                重新读取
              </Button>
            </div>
          )}
          {error === "" && snapshot === null && (
            <p className="text-t-sm text-muted-foreground" role="status">
              正在读取快照
            </p>
          )}
          {snapshot !== null && index === 0 && (
            <dl className="text-t-sm">
              {Object.entries({
                配置名: snapshot.endpoint.name,
                模型: snapshot.endpoint.model,
                ...(snapshot.endpoint.request_params ?? {}),
                api_format: snapshot.endpoint.api_format,
                base_url: snapshot.endpoint.base_url,
              }).map(([key, value]) => (
                // 纵列行制（笔⑤＝稿 .lb-snap-kvr／§11 .kv 的实例档）：键列 150、值占满右侧
                // 且行内换行，行距 s-1。
                <div className="flex items-baseline gap-3 py-1" key={key}>
                  <dt className="w-[150px] flex-none text-muted-foreground">
                    {readableParam(key)}
                  </dt>
                  <dd className="min-w-0 flex-1 break-anywhere font-medium text-text-1">
                    {typeof value === "string" ? value : JSON.stringify(value)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {snapshot !== null && index === 1 && (
            <>
              <ViewHead label="基础提示词" hash={snapshot.prompt.sha256} />
              <Body text={snapshot.prompt.body} />
            </>
          )}
          {skill !== undefined && (
            <>
              {/* 文件胶囊条（笔⑱＝稿 .lb-snap-pills × base.css §9 .file-chip）：列该 Skill
                  包里被冻结的文本文件，默认选 SKILL.md，点胶囊换文件与视图头行哈希。 */}
              <div className="mb-3 flex flex-wrap gap-2">
                {skill.files.map((file) => (
                  <button
                    aria-pressed={file.path === shownFile?.path}
                    className={cn(
                      "inline-flex max-w-[260px] items-center gap-1 rounded-full border px-3 py-1 text-t-sm",
                      file.path === shownFile?.path
                        ? "border-primary bg-primary/10 text-primary dark:bg-primary/26"
                        : "border-border bg-card text-text-2 hover:bg-accent",
                    )}
                    key={file.path}
                    onClick={() => setFilePath(file.path)}
                    type="button"
                  >
                    <span className="min-w-0 truncate">{file.path}</span>
                  </button>
                ))}
              </div>
              {shownFile !== undefined && (
                <ViewHead label={shownFile.path} hash={shownFile.sha256} />
              )}
              {shownFile !== undefined && <Body text={shownFile.body} />}
            </>
          )}
        </div>
        {/* 页脚线随稿的条件式走：本窗正文段在内容区里（不是 .modal-body），只有失败那一态
            画线（稿 `.modal-foot:has(.modal-error)`）。 */}
        <DialogFooter className={error !== "" ? "border-t" : undefined}>
          {snapshot !== null && (
            // 元信息从正文尾挪页脚左位（笔⑨）：整行不折行、超长省略，全文（含 64 位哈希）进气泡。
            <Tip
              label={`快照时间 ${new Date(snapshot.built_at).toLocaleString()} · 工具版本 ${snapshot.tool_version} · 快照哈希 ${snapshot.sha256}`}
            >
              <span className="mr-auto min-w-0 truncate whitespace-nowrap text-t-md text-text-1">
                {`快照时间 ${new Date(snapshot.built_at).toLocaleString()} · 工具版本 ${snapshot.tool_version} · 快照哈希 ${snapshot.sha256}`}
              </span>
            </Tip>
          )}
          {/* 复制反馈＝钮本体换装（笔⑭）：成功对勾／失败红叉、1.5s 复位，文字行退役；
              未就绪（读取中／失败）禁用并随态给 Tip。页脚两钮 flex:none（笔⑮＝§13）。 */}
          <Tip label={copyTip}>
            <Button
              aria-label={copyLabel}
              className="flex-none"
              disabled={snapshot === null}
              onClick={() => void copy()}
              size="icon"
              variant="ghost"
            >
              {copyState === "ok" ? (
                <CheckIcon />
              ) : copyState === "fail" ? (
                <XIcon className="text-bad-ink" />
              ) : (
                <CopyIcon />
              )}
            </Button>
          </Tip>
          <Button className="flex-none" onClick={onClose} variant="outline">
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
