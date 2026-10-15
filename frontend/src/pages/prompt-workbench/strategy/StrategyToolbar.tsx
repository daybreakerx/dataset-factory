import { CheckIcon } from "lucide-react";
import { type ReactElement, useEffect, useRef, useState } from "react";
import type { EndpointConfigSummary, PromptInfo, SkillInfo } from "../../../api";
import { api } from "../../../api";
import { DialogShell } from "../../../components/dialog-shell";
import { FormError } from "../../../components/form-error";
import { Button } from "../../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { Tip } from "../../../components/ui/tooltip";
import { UnsavedConfirmDialog } from "../../../components/unsaved-confirm-dialog";
import { reportError } from "../../../lib/feedback";
import {
  isStrategySelection,
  readStoredJson,
  WORKBENCH_STRATEGY_KEY,
  writeStoredJson,
} from "../../../lib/ui-storage";
import { StrategyMenu } from "./strategy-menu";
import { type Strategy, useStrategies } from "./use-strategies";

type References = Pick<Strategy, "endpoint_id" | "prompt_id" | "skill_ids">;

export function StrategyToolbar({
  references,
  prompts,
  skills,
  endpoints,
  locked,
  promptDirty,
  onSelect,
  onNewStrategy,
  onStrategySaved,
  onRestored,
  onSwitchWhileDirty,
  pendingSwitch,
  onPendingSwitchHandled,
  onEndpointSaveError,
}: {
  references: References;
  prompts: PromptInfo[];
  skills: SkillInfo[];
  endpoints: EndpointConfigSummary[];
  /** 瞬态忙类锁（发送／保存飞行／切策略飞行）：点策略行静默拦——口径不变。 */
  locked: boolean;
  /** 提示词侧有未保存改动：点非当前策略行不再就地拦截，改上抛由上层弹「未保存确认弹窗」兜底。 */
  promptDirty: boolean;
  onSelect: (strategy: Strategy) => Promise<void>;
  /** 点「新建策略」时回调：换桶语义，工作域据此进 __new__ 桶（会话归属 v3）。 */
  onNewStrategy: () => void;
  /** 新策略落库成功后回调：工作域把当前草稿会话改挂到新策略 id（会话归属 v3）。 */
  onStrategySaved: (strategy: Strategy) => void;
  /** 启动恢复认领了策略时回调：端点 chip 锚定该策略冻结的端点（随跳同语义）。 */
  onRestored: (strategy: Strategy) => void;
  /** 提示词 dirty 时点了非当前策略行：上层起确认弹窗（保存／放弃后放行）。 */
  onSwitchWhileDirty: (strategy: Strategy) => void;
  /** 弹窗放行（保存或放弃完成）后的继续切换请求；执行完回调清空。 */
  pendingSwitch: Strategy | null;
  onPendingSwitchHandled: () => void;
  /** 选端点触发的自动保存失败落点：
   *  文字落右栏对话头行 chip 右侧槽；空串＝清（下一次保存成功即清）。 */
  onEndpointSaveError: (text: string) => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const { entries, loading, error, setEntries, setError } = useStrategies(open);
  const [selected, setSelected] = useState<Strategy | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [remove, setRemove] = useState<Strategy | null>(null);
  const [repair, setRepair] = useState<Strategy | null>(null);
  // 创建成功反馈：原地转无底绿色对勾、三秒自动消失（保存钮稿 策略行实例）。
  const [createdFlash, setCreatedFlash] = useState(false);
  // ---------- 新建策略草稿 × 点其他策略行的确认弹窗（未保存确认弹窗稿 形态约定行） ----------
  const [draftSwitchOpen, setDraftSwitchOpen] = useState(false);
  const [draftSwitchError, setDraftSwitchError] = useState("");
  const [draftSwitchBusy, setDraftSwitchBusy] = useState(false);
  const [draftSwitchTarget, setDraftSwitchTarget] = useState<Strategy | null>(null);
  const [bindings, setBindings] = useState<References>({
    endpoint_id: "",
    prompt_id: "",
    skill_ids: [],
  });
  const mounted = useRef(true);
  const pending = useRef(false);
  // 名字框承载块：策略库弹层的宽度下限与贴边方向基准（族宽三段式，随组件归一引入）。
  const nameWrapRef = useRef<HTMLDivElement>(null);
  // 策略选中镜像的写入门闩：挂载首帧不写（防止空白态冲掉既有镜像），任何真实
  // 交互（新建 / 改名 / 选中等）后才落盘。见下方持久化与恢复两个 effect。
  const selectionTouched = useRef(false);
  // 启动恢复的一次性门闩：镜像认领 + 签名认领只试一轮，之后交给用户。
  const selectionResolved = useRef(false);
  // ---------- 动作级实时保存（保存钮稿 策略行实例，2026-10-04 裁） ----------
  // 切策略流程会更新 references（选策略 → 应用它的引用）；置位期间引用 effect
  // 不触发自动保存——保存的时机归切换流程自身，否则中间帧会拿旧 selected 误存。
  const suppressAutoSaveRef = useRef(false);
  // 自动保存串行链：连续动作（失焦保存未回包又选端点）排队执行、不丢保存；
  // choose 前也等它落定，避免「编辑保存」与「切换」竞态。
  const autoSaveChainRef = useRef<Promise<void>>(Promise.resolve());
  // refs 与「selected/name/description」的镜像 ref：effect 与串行链回调里读最新值，
  // 不进闭包（deps 也因此收窄到真正触发时机）。
  const refsRef = useRef(references);
  refsRef.current = references;
  const editRef = useRef({ selected, name, description });
  editRef.current = { selected, name, description };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // 策略选中镜像落盘：id + 名称/描述缓冲 + 签名四元组（会话域对账与重启恢复都认它）。
  // 新建态（无选中）落 null——新建草稿缓冲不跨重启；门闩未开不写，防止挂载首帧
  // 用空白冲掉既有镜像。
  useEffect(() => {
    if (!selectionTouched.current) return;
    writeStoredJson(
      WORKBENCH_STRATEGY_KEY,
      selected === null
        ? null
        : {
            id: selected.id,
            name,
            description,
            endpoint_id: selected.endpoint_id,
            prompt_id: selected.prompt_id,
            skill_ids: selected.skill_ids,
          },
    );
  }, [selected, name, description]);

  // 策略选中的启动恢复（会话归属 v3，归属即身份）：镜像键三分支——
  // ① 键存在且指向策略 → 按 id 对号入座（名称/描述用镜像缓冲；认领写回的镜像
  //    名称为空，从库里补全并落回完整镜像）；指向已删除的策略则不认领。
  // ② 键存在且为 null → 用户停在新建策略态（或会话域认领过并定案），不认领。
  // ③ 键不存在 → 会话域（ChatSessionProvider）是认领的唯一发起方，这里只轮询
  //    等它落盘（最多约 3s）；超时仍无键就停在新建态。本组件 boot 不发请求。
  useEffect(() => {
    if (selectionResolved.current || selectionTouched.current) return;
    if (loading || entries.length === 0) return;
    if (selected !== null || name !== "" || description !== "") {
      selectionResolved.current = true;
      return;
    }
    const restoreFrom = (mirrorId: string | null): void => {
      if (mirrorId === null) {
        selectionResolved.current = true;
        return;
      }
      const byId = entries.find((entry) => entry.id === mirrorId);
      if (byId !== undefined) {
        const mirror = readStoredJson(WORKBENCH_STRATEGY_KEY, isStrategySelection);
        setSelected(byId);
        onRestored(byId);
        setName(mirror?.name || byId.name);
        setDescription(mirror?.description || byId.description);
        // 补全认领写回的骨架镜像（空名称）——落回完整版，下次重启直接用。
        if (mirror !== null && mirror.name === "") selectionTouched.current = true;
      }
      // 镜像指向已删除的策略：不认领（用户明确选过它，它没了就空着）。
      selectionResolved.current = true;
    };
    let attempts = 0;
    let timer = 0;
    const tick = (): void => {
      const raw = localStorage.getItem(WORKBENCH_STRATEGY_KEY);
      if (raw !== null) {
        const mirror = readStoredJson(WORKBENCH_STRATEGY_KEY, isStrategySelection);
        restoreFrom(mirror?.id ?? null);
        return;
      }
      attempts += 1;
      if (attempts >= 10) {
        selectionResolved.current = true;
        return;
      }
      timer = window.setTimeout(tick, 300);
    };
    tick();
    return () => {
      window.clearTimeout(timer);
    };
  }, [entries, loading, selected, name, description, onRestored]);

  const remember = (entry: Strategy): void => {
    setEntries((current) =>
      [...current.filter((item) => item.id !== entry.id), entry].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    );
  };
  const operate = async (operation: () => Promise<void>): Promise<void> => {
    if (pending.current) return;
    pending.current = true;
    selectionTouched.current = true;
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (err) {
      if (mounted.current) setError(reportError(err) ?? "");
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  // 与选中策略现值一致则无需保存（引用 effect 会因对象引用变化触发，内容未必变）。
  const sameAsSelected = (nm: string, ds: string, refs: References): boolean => {
    const sel = editRef.current.selected;
    if (sel === null) return false;
    return (
      nm === sel.name &&
      ds === sel.description &&
      refs.endpoint_id === sel.endpoint_id &&
      refs.prompt_id === sel.prompt_id &&
      JSON.stringify(refs.skill_ids) === JSON.stringify(sel.skill_ids)
    );
  };

  const runAutoSave = async (source: "endpoint" | "edit"): Promise<void> => {
    if (!mounted.current) return;
    const { selected: sel, name: nm, description: ds } = editRef.current;
    const refs = refsRef.current;
    // 名称空不发请求（保存钮稿：前端校验拦中间态）；新建态无自动保存——显式走创建钮。
    if (sel === null || nm.trim() === "") return;
    // 引用没灌全不发自动保存：进页时端点/提示词列表异步拉、references 有一瞬是空
    //（策略真值还没灌进对话列选择器），此时发一次空引用 update 会撞后端 require_refs_exist
    // 400「端点配置「」不存在；基础提示词「」不存在」——冷启即闪一条假红、下一次正确保存自愈。
    // 库策略本就要求端点＋提示词都在，空引用永非合法保存态，跳过零副作用（与草稿弹窗 :392 同尺）。
    if (!refs.endpoint_id || !refs.prompt_id) return;
    if (sameAsSelected(nm.trim(), ds, refs)) return;
    try {
      const entry = await api.updateStrategy(sel.id, {
        name: nm.trim(),
        description: ds,
        ...refs,
      });
      if (!mounted.current) return;
      selectionTouched.current = true;
      remember(entry);
      setSelected(entry);
      setName(entry.name);
      setDescription(entry.description);
      setError("");
      // 保存成功清两处失败行（策略行槽与 chip 槽——「下一次保存成功即清」）。
      onEndpointSaveError("");
    } catch (err) {
      if (!mounted.current) return;
      const text = reportError(err);
      if (text === null) return; // 环境类：浮层已承接
      if (source === "endpoint") onEndpointSaveError(text);
      else setError(text);
    }
  };
  const queueAutoSave = (source: "endpoint" | "edit"): void => {
    autoSaveChainRef.current = autoSaveChainRef.current.then(() => runAutoSave(source));
  };

  // 引用动作级实时保存：选端点／选提示词／勾或取消 Skill 各触发一次（保存钮稿）。
  // 名称描述的编辑由失焦/回车显式触发，不在这里（打字过程不发请求）。
  // 失败落点跟触发源走：端点变化 → chip 槽（对话头行）；其余 → 策略行槽。
  const prevEndpointRef = useRef(references.endpoint_id);
  const queueRef = useRef<(source: "endpoint" | "edit") => void>(() => {});
  queueRef.current = queueAutoSave;
  useEffect(() => {
    const endpointChanged = prevEndpointRef.current !== references.endpoint_id;
    prevEndpointRef.current = references.endpoint_id;
    if (suppressAutoSaveRef.current) return;
    if (editRef.current.selected === null) return;
    queueRef.current(endpointChanged ? "endpoint" : "edit");
  }, [references]);

  // 名称描述编辑完成（失焦或回车）：名称清空且选中策略在场 → 回退旧名（保存钮稿
  // 「清空后失焦＝回退旧名」），否则走实时保存。新建态无回退对象，交给创建钮。
  const flushNameEdit = (): void => {
    const sel = editRef.current.selected;
    if (sel !== null && name.trim() === "") {
      setName(sel.name);
      return;
    }
    queueAutoSave("edit");
  };

  /** 应用某个策略的通用簿记（choose 与新建草稿弹窗的保存路共用）。 */
  const applyStrategy = async (entry: Strategy): Promise<void> => {
    await onSelect(entry);
    if (!mounted.current) return;
    setSelected(entry);
    setName(entry.name);
    setDescription(entry.description);
    setOpen(false);
  };

  /** 切换执行主体（草稿判定之后的全部分流）：choose 与草稿弹窗放弃路共用——
   *  放弃路在清空草稿的同一拍调用，不能回走 choose（闭包里还是清空前的状态）。 */
  const performSwitch = async (entry: Strategy): Promise<void> => {
    if (pending.current || loading) return;
    if (entry.damaged) {
      // 损坏条目：没有可切换的组合，点行 = 走删除
      // 确认弹窗（损坏条目版）——不立「重新指定·文件损坏态」（没东西可重指）。
      setRemove(entry);
      setOpen(false);
      return;
    }
    if (!entry.available) {
      // 缺失引用位的选择器初始为空：
      // 不预选悬空值，确认钮在两选择器都选到现存资产前禁用；Skill 勾选沿用现值。
      setBindings({
        endpoint_id: "",
        prompt_id: "",
        skill_ids: entry.skill_ids,
      });
      setRepair(entry);
      setOpen(false);
      return;
    }
    if (locked) return;
    if (promptDirty) {
      // 提示词跨行锁（保存钮稿「切换策略锁定」）：拦截形态随 提示词下拉 件——
      // 上层弹「未保存确认弹窗」，保存或放弃后经 pendingSwitch 放行继续切换。
      setOpen(false);
      onSwitchWhileDirty(entry);
      return;
    }
    // 切换前等在途编辑保存落定（打开弹层即失焦保存，可能与切行竞态）；
    // suppress 罩住整个窗口：切换引发的 references 变化不走自动保存。
    suppressAutoSaveRef.current = true;
    try {
      await autoSaveChainRef.current;
      await operate(async () => {
        await applyStrategy(entry);
      });
    } finally {
      suppressAutoSaveRef.current = false;
    }
  };

  const choose = (entry: Strategy): void => {
    // 新建态有草稿（名称/描述已填、尚未落库）：切走即丢草稿——起「未保存确认弹窗」
    // 兜底（未保存确认弹窗稿 形态约定行；2026-10-05 用户裁，替代静默拦）。
    if (selected === null && (name !== "" || description !== "")) {
      setOpen(false);
      setDraftSwitchTarget(entry);
      setDraftSwitchError("");
      setDraftSwitchOpen(true);
      return;
    }
    void performSwitch(entry);
  };

  // 弹窗放行后的继续切换（one-shot）：门闩防 StrictMode 双跑。
  const chooseRef = useRef(choose);
  chooseRef.current = choose;
  const handledSwitchRef = useRef<Strategy | null>(null);
  useEffect(() => {
    if (pendingSwitch === null || handledSwitchRef.current === pendingSwitch) return;
    handledSwitchRef.current = pendingSwitch;
    onPendingSwitchHandled();
    void chooseRef.current(pendingSwitch);
  }, [pendingSwitch, onPendingSwitchHandled]);

  const create = (): void => {
    void operate(async () => {
      const body = { name: name.trim(), description, ...references };
      const entry = await api.createStrategy(body);
      if (!mounted.current) return;
      remember(entry);
      setSelected(entry);
      setName(entry.name);
      setDescription(entry.description);
      // 新落库的策略：把当前草稿桶的会话改挂到它名下（会话归属 v3——保存前聊的
      // 就是「这个策略」的对话，落库即认领）。
      onStrategySaved(entry);
      setCreatedFlash(true);
      window.setTimeout(() => {
        if (mounted.current) setCreatedFlash(false);
      }, 3000);
    });
  };

  /** 新建草稿弹窗「保存修改」（primary）＝创建该策略（弹窗内红字拦前端校验；
   *  后端业务错误也进弹窗红字、环境类走浮层）→ 成功后继续切到目标行。 */
  const confirmDraftSwitch = async (): Promise<void> => {
    if (draftSwitchBusy) return;
    if (name.trim() === "") {
      setDraftSwitchError("请填写策略名称");
      return;
    }
    if (!references.prompt_id || !references.endpoint_id) {
      setDraftSwitchError("请先选择端点和提示词");
      return;
    }
    const target = draftSwitchTarget;
    pending.current = true;
    setBusy(true);
    setDraftSwitchBusy(true);
    setError("");
    try {
      const entry = await api.createStrategy({
        name: name.trim(),
        description,
        ...references,
      });
      if (!mounted.current) return;
      selectionTouched.current = true;
      remember(entry);
      setSelected(entry);
      setName(entry.name);
      setDescription(entry.description);
      onStrategySaved(entry);
      setCreatedFlash(true);
      window.setTimeout(() => {
        if (mounted.current) setCreatedFlash(false);
      }, 3000);
      setDraftSwitchOpen(false);
      setDraftSwitchError("");
      setDraftSwitchTarget(null);
      // 创建成功继续切换目标行（直接走簿记，不经 choose——它会被 pending 挡掉）。
      if (target !== null) await applyStrategy(target);
    } catch (err) {
      if (!mounted.current) return;
      const text = reportError(err);
      if (text !== null) setDraftSwitchError(text);
    } finally {
      pending.current = false;
      if (mounted.current) {
        setBusy(false);
        setDraftSwitchBusy(false);
      }
    }
  };

  /** 弹窗「放弃修改」（secondary）＝丢弃新建草稿 → 继续切换目标行。 */
  const discardDraftSwitch = (): void => {
    if (draftSwitchBusy) return;
    const target = draftSwitchTarget;
    setSelected(null);
    setName("");
    setDescription("");
    setCreatedFlash(false);
    setDraftSwitchOpen(false);
    setDraftSwitchError("");
    setDraftSwitchTarget(null);
    // 清空后直接走切换主体（不复走 choose——同一拍闭包里还是清空前的草稿态，
    // 会把草稿弹窗再拉起来）。
    if (target !== null) void performSwitch(target);
  };

  /** 叉号／Esc：关弹窗、留在新建态（草稿原样保留）。 */
  const closeDraftSwitch = (open: boolean): void => {
    if (open) return;
    setDraftSwitchOpen(false);
    setDraftSwitchError("");
    setDraftSwitchTarget(null);
  };

  return (
    <header className="col-span-full border-b border-border px-6 pt-6 pb-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div
          ref={nameWrapRef}
          className="relative flex min-w-0 max-w-full items-center"
        >
          <input
            aria-label="策略名称"
            placeholder="新建策略"
            value={name}
            maxLength={100}
            disabled={busy}
            onChange={(event) => {
              selectionTouched.current = true;
              setName(event.currentTarget.value);
            }}
            onBlur={flushNameEdit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                flushNameEdit();
              }
            }}
            className="min-w-24 max-w-[380px] field-sizing-content rounded-md border border-transparent bg-transparent py-1 pr-7 pl-2 text-t-2xl font-semibold hover:border-border hover:bg-card focus:border-input focus:outline-none"
          />
          <StrategyMenu
            open={open}
            onOpenChange={setOpen}
            entries={entries}
            selected={selected}
            busy={busy}
            loading={loading}
            error={error}
            wrapRef={nameWrapRef}
            prompts={prompts}
            skills={skills}
            endpoints={endpoints}
            onNew={() => {
              selectionTouched.current = true;
              selectionResolved.current = true;
              setSelected(null);
              setName("");
              setDescription("");
              setCreatedFlash(false);
              setOpen(false);
              // 新建 = 离开当前配置（换底座）：会话清空，与切策略同语义。
              onNewStrategy();
            }}
            onChoose={(entry) => {
              void choose(entry);
            }}
            onCopy={(entry) =>
              void operate(async () => {
                const copy = await api.copyStrategy(entry.id);
                if (mounted.current) remember(copy);
              })
            }
            onRemove={(entry) => {
              setRemove(entry);
              setOpen(false);
            }}
          />
        </div>
        {/* 两行制折行（稿侧 .wt-tail 的等价 Tailwind 结构）：
            描述框＋失败槽＋右侧钮包进不可折行分组一体同行（内部永不折行、保存钮恒在
            行尾），窄到放不下才整体落到第二行；最左的名字框独行。min-w-144 = desc
            min 96＋gap 8＋保存钮实宽 40 的折行底线。 */}
        <div className="flex min-w-[144px] flex-1 items-center gap-2">
          <input
            aria-label="策略描述"
            placeholder="适用场景与写作风格"
            value={description}
            disabled={busy}
            onChange={(event) => {
              selectionTouched.current = true;
              setDescription(event.currentTarget.value);
            }}
            onBlur={() => queueAutoSave("edit")}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                queueAutoSave("edit");
              }
            }}
            className="min-w-24 max-w-[420px] field-sizing-content rounded-md border border-transparent bg-transparent px-2 py-1 text-t-md text-text-3 hover:border-border hover:bg-card focus:border-input focus:outline-none"
          />
          {error !== "" && remove === null && repair === null && (
            // 行内失败槽（保存钮稿「失败提示行」；与切换／复制失败同槽共用）：
            // note-inline--bad 等价类——单行省略＋悬停给全文；下一次保存成功即清。
            <Tip label={error}>
              <span
                role="alert"
                className="min-w-[200px] max-w-full truncate text-t-sm text-bad-ink"
              >
                {error}
              </span>
            </Tip>
          )}
          {createdFlash ? (
            // 创建成功的原地反馈（保存钮稿「创建 · 成功」）：无底绿色对勾、读屏播报、
            // 三秒自动消失。放在 selected 条件外——创建成功即选中（selected 已更新），
            // 对勾仍要驻留三秒。
            <CheckIcon
              aria-label="已创建"
              role="status"
              className="size-(--icon-md) shrink-0 text-ok-ink"
            />
          ) : (
            selected === null && (
              // 显式创建（保存钮稿「创建态」）：仅新建策略态渲染，占原保存钮位置。
              <>
                <span className="hidden flex-1 sm:block" />
                <Tip
                  label={
                    name.trim() === ""
                      ? "请填写策略名称"
                      : !references.prompt_id || !references.endpoint_id
                        ? "请先选择端点和提示词"
                        : ""
                  }
                >
                  <Button
                    size="sm"
                    disabled={
                      !name.trim() || !references.prompt_id || !references.endpoint_id
                    }
                    aria-disabled={busy || undefined}
                    className={busy ? "pointer-events-none" : undefined}
                    onClick={() => {
                      if (busy) return;
                      create();
                    }}
                  >
                    创建
                  </Button>
                </Tip>
              </>
            )
          )}
        </div>
      </div>
      <DialogShell
        open={remove !== null}
        // 飞行期 Esc 也可关（弹窗壳稿「关掉的是界面、不撤销已发出的请求」），与其余删除弹窗一致。
        onOpenChange={(open) => {
          if (!open) setRemove(null);
        }}
        title={
          remove?.damaged ? (
            <>删除损坏的策略条目？</>
          ) : (
            <>删除策略「{remove?.name}」？</>
          )
        }
        description={
          remove?.damaged
            ? "该策略文件已损坏，内容无法读取。"
            : "已应用到工作目录的快照不受影响；被引用的提示词与 Skill 不会被删除。"
        }
        note="此操作不可撤销"
        flight={busy}
        closeTip={busy ? "关闭不等于撤销删除" : ""}
        cancel={{
          label: "取消",
          onClick: () => setRemove(null),
        }}
        confirm={{
          label: "删除",
          variant: "danger-text",
          onClick: () =>
            void operate(async () => {
              if (!remove) return;
              await api.deleteStrategy(remove.id);
              if (!mounted.current) return;
              setEntries((current) =>
                current.filter((entry) => entry.id !== remove.id),
              );
              if (selected?.id === remove.id) {
                setSelected(null);
                setName("");
                setDescription("");
              }
              setRemove(null);
            }),
        }}
      >
        {error !== "" && (
          <FormError data-dialog-error className="text-t-sm text-bad-ink">
            {error}
          </FormError>
        )}
      </DialogShell>
      <UnsavedConfirmDialog
        open={draftSwitchOpen}
        onOpenChange={closeDraftSwitch}
        flight={draftSwitchBusy}
        error={draftSwitchError}
        onSave={() => void confirmDraftSwitch()}
        onDiscard={discardDraftSwitch}
      />
      <DialogShell
        open={repair !== null}
        onOpenChange={(open) => {
          if (!open) setRepair(null);
        }}
        title={<>重新指定「{repair?.name}」</>}
        description={repair?.missing_refs.join("；")}
        headNote={error || undefined}
        flight={busy}
        closeTip={busy ? "关闭不等于撤销删除" : ""}
        cancel={{
          label: "取消",
          onClick: () => setRepair(null),
        }}
        confirm={{
          label: "重新指定",
          disabled: !bindings.endpoint_id || !bindings.prompt_id,
          onClick: () =>
            void operate(async () => {
              if (!repair) return;
              const entry = await api.rebindStrategy(repair.id, bindings);
              if (!mounted.current) return;
              remember(entry);
              setRepair(null);
            }),
        }}
      >
        <div className="grid gap-2 text-t-sm">
          端点
          {/* L12（2026-09-21 审计）：全站唯一的原生 select 破口 → Radix Select。 */}
          <Select
            value={bindings.endpoint_id}
            disabled={busy}
            onValueChange={(value) => setBindings({ ...bindings, endpoint_id: value })}
          >
            <SelectTrigger aria-label="重新指定端点" className="h-(--h-lg)">
              <SelectValue placeholder="选择端点" />
            </SelectTrigger>
            <SelectContent>
              {/* 缺失信息由弹窗描述位 missing_refs 清单承载；选择器只列现存资产
                  （撤悬空 ID 的禁用灰项）。 */}
              {endpoints.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2 text-t-sm">
          提示词
          <Select
            value={bindings.prompt_id}
            disabled={busy}
            onValueChange={(value) => setBindings({ ...bindings, prompt_id: value })}
          >
            <SelectTrigger aria-label="重新指定提示词" className="h-(--h-lg)">
              <SelectValue placeholder="选择提示词" />
            </SelectTrigger>
            <SelectContent>
              {prompts.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <fieldset disabled={busy} className="grid gap-2">
          <legend className="mb-2 text-t-sm">Skill</legend>
          {Array.from(
            new Set([
              ...bindings.skill_ids,
              ...skills.filter((entry) => entry.enabled).map((entry) => entry.id),
            ]),
          ).map((sid) => (
            <label key={sid} className="flex items-center gap-2 text-t-sm">
              <input
                type="checkbox"
                className="cb"
                checked={bindings.skill_ids.includes(sid)}
                onChange={(event) =>
                  setBindings({
                    ...bindings,
                    skill_ids: event.currentTarget.checked
                      ? [...bindings.skill_ids, sid]
                      : bindings.skill_ids.filter((item) => item !== sid),
                  })
                }
              />
              {skills.find((entry) => entry.id === sid)?.name ?? sid}
              {skills.some((entry) => entry.id === sid && entry.enabled)
                ? ""
                : "（缺失或停用）"}
            </label>
          ))}
        </fieldset>
      </DialogShell>
    </header>
  );
}
