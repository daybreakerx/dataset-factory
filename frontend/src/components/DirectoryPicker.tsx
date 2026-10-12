import {
  ArrowUpIcon,
  FileIcon,
  FolderIcon,
  FolderPlusIcon,
  ImageIcon,
  PencilIcon,
  VideoIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { api, errorMessage } from "../api";
import type { components } from "../api-types.gen";
import { FormError } from "../components/form-error";
import { formatBytes } from "../lib/format";
import { cn } from "../lib/utils";
import { DialogShell } from "./dialog-shell";
import { HScroll } from "./hs-scroll";
import { Button } from "./ui/button";
import { DialogDescription, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Tip } from "./ui/tooltip";

type Listing = components["schemas"]["DirectoryListing"];
type Entry = components["schemas"]["DirectoryEntry"];
interface Props {
  initialPath?: string;
  files?: boolean;
  suffixes?: string[];
  browseOnly?: boolean;
  allowRename?: boolean;
  allowCreate?: boolean;
  /** 调用方定制（稿：本件只承载基础能力，定制态归调用方件）：主钮文案。 */
  primaryLabel?: string;
  /** 调用方定制：调用点自报标题（稿「修改路径」变体；缺省按形态取「选择目录」等三题字）。 */
  titleText?: string;
  /** 调用方定制：头行副题槽（稿 .dp-host，缺省显后端身份；变体可换成「当前：〈注册路径〉」）。 */
  hostText?: ReactNode;
  /** 调用方定制：标题行反馈槽琥珀短句（稿 .modal-head-note--warn，随调用点常驻，不进基础形态）。 */
  headWarn?: ReactNode;
  /** 调用方定制：正文一行红字（稿 .dp-errorline）——受理被拒只给原因，主钮照常可点（改完条件原地再点）。 */
  bodyError?: string;
  /** 组件能力参数（稿「要求目标为空」）：目标非空则主钮不亮＋title 给原因，判空取后端真值。 */
  requireEmptyTarget?: boolean;
  onClose: () => void;
  onSelect: (path: string, listing: Listing) => void;
}

/** 慢击判定窗（稿 demo 口径 0.5s）：单击名字在窗内没有第二击＝进改名；窗内来了第二击＝双击归行。 */
const SLOW_CLICK_MS = 500;

export function DirectoryPicker({
  initialPath = "",
  files = false,
  suffixes = [],
  browseOnly = false,
  allowRename = false,
  allowCreate = false,
  primaryLabel,
  titleText,
  hostText,
  headWarn,
  bodyError,
  requireEmptyTarget = false,
  onClose,
  onSelect,
}: Props) {
  const [location, setLocation] = useState(initialPath);
  const [input, setInput] = useState(initialPath);
  const [listing, setListing] = useState<Listing | null>(null);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [canOpen, setCanOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [renameError, setRenameError] = useState("");
  const [mutationBusy, setMutationBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const mounted = useRef(false);
  const mutationPending = useRef(false);
  const slowClick = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inputEdits = useRef(0);
  // 面包屑在取数中与失败时也要在场（稿格 4/5 裁：没有面包屑就没有原点重试途径）——
  // `system` 只在回包里带，按目标路径渲染时沿用上一次认到的那份。
  const systemRef = useRef<string | null>(null);
  const nameInputId = useId();
  const suffixKey = JSON.stringify(suffixes);

  useEffect(() => {
    mounted.current = true;
    return () => {
      if (slowClick.current) clearTimeout(slowClick.current);
    };
  }, []);

  useEffect(() => {
    if (!browseOnly) return;
    let current = true;
    void api
      .filesystemCapabilities()
      .then((value) => {
        if (current) setCanOpen(value.open_in_file_manager === true);
      })
      .catch(() => {
        if (current) setCanOpen(false);
      });
    return () => {
      current = false;
    };
  }, [browseOnly]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision retries the same path after a failed read.
  useEffect(() => {
    let current = true;
    const editsAtRequest = inputEdits.current;
    setLoading(true);
    setSelected(null);
    setListing(null);
    setError("");
    setRenamingPath(null);
    setCreating(false);
    const filter: string[] = JSON.parse(suffixKey);
    void api
      .listDirectory(location, files || browseOnly, hidden, browseOnly ? [] : filter)
      .then((value) => {
        if (!current) return;
        setListing(value);
        systemRef.current = value.system;
        if (inputEdits.current === editsAtRequest) setInput(value.path);
      })
      .catch((reason: unknown) => {
        if (current) setError(errorMessage(reason));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [location, files, hidden, browseOnly, suffixKey, revision]);

  function navigate(path: string) {
    if (mutationPending.current || !path.trim()) return;
    setRenameError("");
    setLocation(path);
    setRevision((value) => value + 1);
  }

  /** 双击＝进入目录；文件行按变体分两（选文件场景＝采用并关窗，只读浏览＝无额外动作）。 */
  function activate(entry: Entry) {
    if (entry.kind === "directory") {
      navigate(entry.path);
      return;
    }
    if (!browseOnly && listing) onSelect(entry.path, listing);
  }

  function startRename(entry: Entry) {
    // 慢击判定窗可能还挂着（选中行的那一击留下的）：不撤掉它，稍后会把编辑框内容重置回旧名。
    if (slowClick.current) {
      clearTimeout(slowClick.current);
      slowClick.current = undefined;
    }
    setCreating(false);
    setRenamingPath(entry.path);
    setDraftName(entry.name);
    setRenameError("");
  }

  function nameClick(entry: Entry) {
    // 稿口径＝「选中后」慢击才改名（Windows 文件管理器逻辑）：第一击只选中，
    // 站在已选中的那一行上再慢击才是改名意图，否则每回选中都会掉进编辑框。
    const wasSelected = selected?.path === entry.path;
    setSelected(entry);
    if (!allowRename || mutationBusy || !wasSelected) return;
    if (slowClick.current) {
      // 第二击落在判定窗内＝这就是双击，改名不触发。
      clearTimeout(slowClick.current);
      slowClick.current = undefined;
      return;
    }
    slowClick.current = setTimeout(() => {
      slowClick.current = undefined;
      startRename(entry);
    }, SLOW_CLICK_MS);
  }

  function nameDoubleClick(entry: Entry) {
    if (slowClick.current) {
      clearTimeout(slowClick.current);
      slowClick.current = undefined;
    }
    activate(entry);
  }

  /**
   * 改名＝瞬态任务（2026-10-09 裁）：在飞只保持输入框，不设进行中态、不给取消与重查钮；
   * 成功跳新位置重取，失败退回旧名。等待器只把终态翻译成这两条出路，不驱动任何界面。
   */
  async function submitRename(entry: Entry, newName: string): Promise<void> {
    if (mutationPending.current) return;
    mutationPending.current = true;
    setMutationBusy(true);
    setRenameError("");
    try {
      const accepted = await api.renameDirectory(entry.path, newName);
      const taskId = accepted.task_id;
      if (!taskId?.trim()) throw new Error("重命名未被受理，请重试。");
      const result = await waitTask(taskId);
      if (!mounted.current) return;
      setRenamingPath(null);
      setSelected(null);
      setLocation(result.path);
      setRevision((value) => value + 1);
      if (result.cleanup_pending)
        setRenameError("重命名已完成，旧位置尚未清理，请在工作目录设置中处理");
    } catch (reason) {
      if (!mounted.current) return;
      // 退回旧名＝撤编辑框并重取一眼真实盘面，红字说的是这次为什么没改成。
      setRenamingPath(null);
      setRenameError(errorMessage(reason));
      setRevision((value) => value + 1);
    } finally {
      mutationPending.current = false;
      if (mounted.current) setMutationBusy(false);
    }
  }

  async function submitCreate(parentPath: string, name: string): Promise<void> {
    if (mutationPending.current) return;
    mutationPending.current = true;
    setMutationBusy(true);
    setRenameError("");
    try {
      const value = await api.createDirectory(parentPath, name);
      if (!value.path?.trim()) throw new Error("创建结果无效，请重试。");
      if (mounted.current) setCreating(false);
      setLocation(value.path);
      setRevision((total) => total + 1);
    } catch (reason) {
      if (mounted.current) setRenameError(errorMessage(reason));
    } finally {
      mutationPending.current = false;
      if (mounted.current) setMutationBusy(false);
    }
  }

  function commitRename(entry: Entry) {
    const newName = draftName.trim();
    if (!newName || newName === entry.name) {
      setRenamingPath(null);
      return;
    }
    void submitRename(entry, newName);
  }

  const flight = loading || mutationBusy;
  // 打开弹窗总在一个目录内、总有目标（稿 #20 格 14 裁「基础形态无禁用态」）：
  // 未选中时目标＝当前所在目录，选中时目标＝那一行。
  const target = selected?.path ?? listing?.path ?? "";
  // 「要求目标为空」的判空取后端真值：当前层条目受三重筛选，数不出空不空。
  const targetEmpty = selected
    ? selected.is_empty === true
    : listing?.is_empty === true;
  const emptyTargetBlock = requireEmptyTarget && !targetEmpty;
  const emptyTargetReason = selected
    ? `迁移目标目录必须为空——选中的「${selected.name}」不是空目录。`
    : "迁移目标目录必须为空——请选中一个空文件夹，或进入一个空文件夹。";
  const title =
    titleText ?? (browseOnly ? "浏览目录" : files ? "选择目录或文件" : "选择目录");
  const crumbs = breadcrumbsFor(listing?.path || location, systemRef.current);
  const renamingEntry = renamingPath
    ? (listing?.entries.find((entry) => entry.path === renamingPath) ?? null)
    : null;

  return (
    <DialogShell
      open
      // 族规则「退出 ≠ 撤销」：改名在飞也照常可退（关的是界面，任务不受影响）。
      onOpenChange={(open) => !open && onClose()}
      className="w-[min(var(--w-modal-620),calc(100vw-48px))] gap-0 p-4"
    >
      <div className="mb-2 flex flex-wrap items-center gap-3 pr-8">
        <DialogTitle className="text-t-xl font-medium">{title}</DialogTitle>
        <DialogDescription className="min-w-0 break-all text-t-sm">
          {hostText ??
            (listing
              ? `当前后端：${listing.hostname} · ${listing.system}`
              : "当前后端")}
        </DialogDescription>
        {headWarn !== undefined && (
          <span className="min-w-0 flex-1 text-t-sm text-warn-ink">{headWarn}</span>
        )}
      </div>
      <div className="mb-2 flex min-w-0 items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          aria-disabled={flight || !listing?.parent || undefined}
          className="aria-disabled:pointer-events-none"
          onClick={
            flight || !listing?.parent
              ? undefined
              : () => listing?.parent && navigate(listing.parent)
          }
        >
          <ArrowUpIcon />
          上一级
        </Button>
        <nav aria-label="目录路径" className="min-w-0">
          {/* 路径面包屑条＝单行横滚区，走 hs 定式（DESIGN.md 3.3）；段间 `›` 属排版、不进可访问名。 */}
          <HScroll className="text-t-sm text-text-3" trackClassName="gap-0">
            {crumbs.map((crumb, index) => (
              <span key={crumb.path} className="flex shrink-0 items-center">
                {index > 0 && (
                  <span aria-hidden="true" className="text-t-xs text-text-4">
                    ›
                  </span>
                )}
                {/* 末段也保留可点（＝原地重读，取数失败时这是唯一重试出口），只以字色标识当前位。 */}
                <Button
                  variant="ghost"
                  size="xs"
                  className="rounded-sm px-1 py-0.5 font-normal"
                  aria-disabled={flight || undefined}
                  onClick={flight ? undefined : () => navigate(crumb.path)}
                >
                  {crumb.label}
                </Button>
              </span>
            ))}
          </HScroll>
        </nav>
      </div>
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          navigate(input.trim());
        }}
      >
        <Input
          aria-label="服务器路径"
          className="min-w-0 flex-1"
          value={input}
          aria-disabled={mutationBusy || undefined}
          onChange={(event) => {
            inputEdits.current += 1;
            setInput(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (mutationBusy) event.preventDefault();
          }}
        />
        <Button variant="outline" size="lg" type="submit">
          跳转
        </Button>
      </form>
      <div className="mt-2 flex items-center gap-3">
        {allowCreate && (
          <Tip label="新建目录">
            <Button
              variant="ghost"
              size="icon"
              aria-label="新建目录"
              aria-disabled={flight || undefined}
              className="aria-disabled:pointer-events-none"
              onClick={
                flight
                  ? undefined
                  : () => {
                      setRenamingPath(null);
                      setCreating(true);
                      setDraftName("");
                      setRenameError("");
                    }
              }
            >
              <FolderPlusIcon />
            </Button>
          </Tip>
        )}
        {allowRename && selected && !renamingEntry && (
          <Tip label={`重命名 ${selected.name}`}>
            <Button
              variant="ghost"
              size="icon"
              aria-label="重命名"
              aria-disabled={flight || undefined}
              className="aria-disabled:pointer-events-none"
              onClick={flight ? undefined : () => startRename(selected)}
            >
              <PencilIcon />
            </Button>
          </Tip>
        )}
        <label className="ml-auto flex items-center gap-2 text-t-sm text-text-3">
          <input
            type="checkbox"
            className="cb"
            checked={hidden}
            aria-disabled={mutationBusy || undefined}
            onChange={(event) => {
              if (mutationBusy) {
                event.currentTarget.checked = !event.currentTarget.checked;
                return;
              }
              setHidden(event.currentTarget.checked);
            }}
          />
          显示隐藏项
        </label>
      </div>
      {loading && (
        <p role="status" className="py-3 text-t-sm text-text-4">
          正在读取目录
        </p>
      )}
      {error && <FormError className="py-3 text-t-sm text-bad-ink">{error}</FormError>}
      {listing && (
        <section
          className="mt-3 max-h-[296px] overflow-y-auto rounded-lg border border-border bg-card"
          aria-label="目录内容"
        >
          {listing.entries.length === 0 && (
            <p className="px-3 py-2 text-t-sm text-text-3">
              {suffixes.length === 0
                ? "没有匹配的项目"
                : `没有匹配的项目（仅显示 ${suffixes.join(" / ")} 文件）`}
            </p>
          )}
          {listing.entries.map((entry) => {
            const isSelected = selected?.path === entry.path;
            return (
              <div
                key={entry.path}
                className={cn(
                  // 行＝「1px 透明描边槽 ＋ padding 补偿」：选中环显色时内容不被顶偏 1px。
                  "flex items-center gap-3 border border-transparent px-[calc(var(--s-3)-1px)] py-[calc(var(--s-2)-1px)]",
                  "first:rounded-t-[calc(var(--r-md)-1px)] last:rounded-b-[calc(var(--r-md)-1px)]",
                  isSelected
                    ? "border-primary/30 bg-primary/8 text-primary dark:bg-primary/22"
                    : "hover:bg-accent",
                )}
              >
                {renamingPath === entry.path ? (
                  <Input
                    id={nameInputId}
                    // 尺寸随稿 .dp-rename-input（12em／max 60%／高 24），皮肤随全站 .input。
                    className="h-6 w-[12em] max-w-[60%] shrink-0 px-1"
                    aria-label={`重命名 ${entry.name}`}
                    autoFocus
                    value={draftName}
                    onChange={(event) => setDraftName(event.currentTarget.value)}
                    onBlur={() => {
                      if (draftName.trim()) commitRename(entry);
                    }}
                    onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing) return;
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitRename(entry);
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setRenamingPath(null);
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 text-left text-t-md"
                    aria-pressed={isSelected}
                    aria-label={entry.name}
                    onClick={() => nameClick(entry)}
                    onDoubleClick={() => nameDoubleClick(entry)}
                  >
                    <EntryIcon entry={entry} />
                    <span className="truncate" title={entry.name}>
                      {entry.name}
                    </span>
                  </button>
                )}
                <span className="ml-auto shrink-0 text-t-sm tabular-nums text-text-3">
                  {entry.size === null ? "" : `${formatBytes(entry.size, "KB", 1)} · `}
                  {new Date(entry.modified_at).toLocaleString()}
                </span>
              </div>
            );
          })}
        </section>
      )}
      {!!listing?.unavailable_count && (
        <p role="status" className="mt-2 text-t-sm text-warn-ink">
          另有 {listing.unavailable_count} 项无法读取
        </p>
      )}
      {creating && (
        <div className="mt-2 flex items-center gap-2">
          <label
            htmlFor={nameInputId}
            className="flex min-w-0 flex-1 items-center gap-2 text-t-sm"
          >
            <span className="shrink-0">目录名称</span>
            <Input
              id={nameInputId}
              className="min-w-0 flex-1"
              aria-label="目录名称"
              autoFocus
              value={draftName}
              aria-disabled={mutationBusy || undefined}
              onChange={(event) => setDraftName(event.currentTarget.value)}
            />
          </label>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setCreating(false);
              setDraftName("");
            }}
          >
            取消
          </Button>
          <Button
            size="sm"
            disabled={mutationBusy || !draftName.trim() || !listing}
            onClick={() => listing && void submitCreate(listing.path, draftName.trim())}
          >
            创建
          </Button>
        </div>
      )}
      {renameError && (
        <FormError className="mt-2 break-all text-t-sm text-bad-ink">
          {renameError}
        </FormError>
      )}
      {bodyError && (
        <FormError className="mt-2 break-all text-t-sm text-bad-ink">
          {bodyError}
        </FormError>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
        {browseOnly && (
          <span className="mr-auto min-w-0 break-all text-t-sm text-text-3">
            共 {listing?.entries.length ?? 0} 项
          </span>
        )}
        {browseOnly && canOpen && (
          <Tip label="在系统文件资源管理器中打开">
            <Button
              variant="ghost"
              size="icon"
              aria-label="在系统文件资源管理器中打开"
              disabled={opening || !listing}
              onClick={() => {
                if (!listing || opening) return;
                setOpening(true);
                setRenameError("");
                void api
                  .openDirectory(listing.path)
                  .catch((reason: unknown) => {
                    if (mounted.current) setRenameError(errorMessage(reason));
                  })
                  .finally(() => {
                    if (mounted.current) setOpening(false);
                  });
              }}
            >
              <FolderIcon />
            </Button>
          </Tip>
        )}
        <Button variant="ghost" onClick={onClose}>
          {browseOnly ? "关闭" : "取消"}
        </Button>
        {!browseOnly && (
          <Button
            // 主钮是「飞行不换装」通则的唯一例外：没有目标就真禁用（灰档可见）。
            title={emptyTargetBlock ? emptyTargetReason : undefined}
            disabled={
              flight ||
              !!error ||
              !target ||
              emptyTargetBlock ||
              !!renamingEntry ||
              creating ||
              !listing
            }
            onClick={() => target && listing && onSelect(target, listing)}
          >
            {primaryLabel ?? (selected?.kind === "file" ? "选择此文件" : "选择此目录")}
          </Button>
        )}
      </div>
    </DialogShell>
  );
}

/** 图标四态（稿格 3 裁 B）：文件夹／图片／视频／其余文件——判据取后端 `media`，扩展名表不抄第二份。 */
function EntryIcon({ entry }: { entry: Entry }) {
  const Icon =
    entry.kind === "directory"
      ? FolderIcon
      : entry.media === "image"
        ? ImageIcon
        : entry.media === "video"
          ? VideoIcon
          : FileIcon;
  return (
    <Icon
      aria-hidden="true"
      className="size-(--icon-md) shrink-0 text-muted-foreground"
    />
  );
}

function breadcrumbsFor(
  path: string,
  system: string | null,
): { label: string; path: string }[] {
  if (!path) return [];
  const windows = system === "Windows" || /^[A-Za-z]:[\\/]/.test(path);
  const separator = windows ? "\\" : "/";
  const normalized = windows ? path.replaceAll("/", "\\") : path;
  const root = windows
    ? (normalized.match(/^(?:\\\\[^\\]+\\[^\\]+\\?|[A-Za-z]:\\)/)?.[0] ?? "")
    : "/";
  if (!root) return [{ label: normalized, path: normalized }];
  // 根段只留根名（`D:` 而非 `D:\`）：尾缀反斜杠在窄列里会折成孤立符号。
  const rootLabel = windows ? root.replace(/[\\/]$/, "") : root;
  const parts = normalized.slice(root.length).split(separator).filter(Boolean);
  const crumbs = [{ label: rootLabel, path: root }];
  let current = root;
  for (const part of parts) {
    current = `${current.endsWith(separator) ? current : current + separator}${part}`;
    crumbs.push({ label: part, path: current });
  }
  return crumbs;
}

/** 等改名任务落终态并取回新路径；界面不进任何进行中态，这里只把结果翻译成成功／退回两出路。 */
async function waitTask(
  taskId: string,
): Promise<{ path: string; cleanup_pending: boolean }> {
  for (;;) {
    const task = await api.getTask(taskId);
    if (task.status === "succeeded") {
      const result = task.result as { path?: string; cleanup_pending?: boolean };
      if (typeof result?.path !== "string" || !result.path.trim())
        throw new Error("重命名结果无法解析，请刷新目录确认。");
      return {
        path: result.path,
        cleanup_pending: result.cleanup_pending === true,
      };
    }
    if (task.status === "failed")
      throw new Error(task.error ?? "重命名未完成，已退回原名称。");
    if (task.status === "cancelled") throw new Error("重命名已取消，已退回原名称。");
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}
