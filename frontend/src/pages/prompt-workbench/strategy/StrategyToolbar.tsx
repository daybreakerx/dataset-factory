import { type ReactElement, useEffect, useRef, useState } from "react";
import type { EndpointConfigSummary, PromptInfo, SkillInfo } from "../../../api";
import { api } from "../../../api";
import { DialogShell } from "../../../components/dialog-shell";
import { Alert, AlertDescription } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { Tip } from "../../../components/ui/tooltip";
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
  onSelect,
  onNewStrategy,
  onStrategySaved,
  onRestored,
}: {
  references: References;
  prompts: PromptInfo[];
  skills: SkillInfo[];
  endpoints: EndpointConfigSummary[];
  locked: boolean;
  onSelect: (strategy: Strategy) => Promise<void>;
  /** 点「新建策略」时回调：换桶语义，工作域据此进 __new__ 桶（会话归属 v3）。 */
  onNewStrategy: () => void;
  /** 新策略落库成功后回调：工作域把当前草稿会话改挂到新策略 id（会话归属 v3）。 */
  onStrategySaved: (strategy: Strategy) => void;
  /** 启动恢复认领了策略时回调：端点 chip 锚定该策略冻结的端点（随跳同语义）。 */
  onRestored: (strategy: Strategy) => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const { entries, loading, error, setEntries, setError, fetchList } =
    useStrategies(open);
  const [selected, setSelected] = useState<Strategy | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [remove, setRemove] = useState<Strategy | null>(null);
  const [repair, setRepair] = useState<Strategy | null>(null);
  const [bindings, setBindings] = useState<References>({
    endpoint_id: "",
    prompt_id: "",
    skill_ids: [],
  });
  const mounted = useRef(true);
  const pending = useRef(false);
  // 策略选中镜像的写入门闩：挂载首帧不写（防止空白态冲掉既有镜像），任何真实
  // 交互（新建 / 改名 / 选中等）后才落盘。见下方持久化与恢复两个 effect。
  const selectionTouched = useRef(false);
  // 启动恢复的一次性门闩：镜像认领 + 签名认领只试一轮，之后交给用户。
  const selectionResolved = useRef(false);

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
  const choose = async (entry: Strategy): Promise<void> => {
    if (pending.current || locked || loading) return;
    if (!entry.available) {
      setBindings({
        endpoint_id: entry.endpoint_id,
        prompt_id: entry.prompt_id,
        skill_ids: entry.skill_ids,
      });
      setRepair(entry);
      setOpen(false);
      return;
    }
    await operate(async () => {
      await onSelect(entry);
      if (!mounted.current) return;
      setSelected(entry);
      setName(entry.name);
      setDescription(entry.description);
      setOpen(false);
    });
  };
  const dirty =
    selected !== null &&
    (name !== selected.name ||
      description !== selected.description ||
      references.endpoint_id !== selected.endpoint_id ||
      references.prompt_id !== selected.prompt_id ||
      JSON.stringify(references.skill_ids) !== JSON.stringify(selected.skill_ids));
  // 有东西可保存 = 已选策略有改动，或正在编辑一份尚未落库的新策略（新建流程不能被「无改动」禁用）。
  const actionable =
    dirty || (selected === null && (name !== "" || description !== ""));
  const switchLocked =
    locked ||
    busy ||
    dirty ||
    (selected === null && (name !== "" || description !== ""));
  const save = (): void => {
    void operate(async () => {
      const body = { name: name.trim(), description, ...references };
      const entry = selected
        ? await api.updateStrategy(selected.id, body)
        : await api.createStrategy(body);
      if (!mounted.current) return;
      remember(entry);
      setSelected(entry);
      setName(entry.name);
      setDescription(entry.description);
      // 新落库的策略：把当前草稿桶的会话改挂到它名下（会话归属 v3——保存前聊的
      // 就是「这个策略」的对话，落库即认领；改存量策略不动归属）。
      if (selected === null) {
        onStrategySaved(entry);
      }
    });
  };

  return (
    <header className="col-span-full border-b border-border px-6 pt-6 pb-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="relative flex min-w-0 max-w-full items-center">
          <input
            aria-label="策略名称"
            placeholder="新建策略"
            value={name}
            disabled={busy}
            onChange={(event) => {
              selectionTouched.current = true;
              setName(event.currentTarget.value);
            }}
            className="min-w-24 max-w-full field-sizing-content rounded-md border border-transparent bg-transparent py-1 pr-7 pl-2 text-t-2xl font-semibold hover:border-border hover:bg-card focus:border-input"
          />
          <StrategyMenu
            open={open}
            onOpenChange={setOpen}
            entries={entries}
            selected={selected}
            busy={busy}
            loading={loading}
            locked={locked}
            switchLocked={switchLocked}
            prompts={prompts}
            skills={skills}
            endpoints={endpoints}
            onNew={() => {
              selectionTouched.current = true;
              selectionResolved.current = true;
              setSelected(null);
              setName("");
              setDescription("");
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
        <input
          aria-label="策略描述"
          placeholder="描述"
          value={description}
          disabled={busy}
          onChange={(event) => {
            selectionTouched.current = true;
            setDescription(event.currentTarget.value);
          }}
          className="min-w-24 max-w-full field-sizing-content rounded-md border border-transparent bg-transparent px-2 py-1 text-t-md text-text-3 hover:border-border hover:bg-card focus:border-input"
        />
        <span className="hidden flex-1 sm:block" />
        <Tip label={actionable ? "" : "没有未保存的修改"}>
          <Button
            size="sm"
            variant={actionable ? "default" : "ghost"}
            aria-label="保存策略"
            disabled={
              busy ||
              locked ||
              !actionable ||
              !name.trim() ||
              !references.prompt_id ||
              !references.endpoint_id
            }
            onClick={save}
          >
            保存
          </Button>
        </Tip>
      </div>
      {error && !remove && !repair && (
        <Alert variant="destructive" className="mt-2">
          <AlertDescription>{error}</AlertDescription>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              void operate(async () => {
                const list = await fetchList();
                if (mounted.current) setEntries(list);
              })
            }
          >
            刷新策略库
          </Button>
        </Alert>
      )}
      <DialogShell
        open={remove !== null}
        onOpenChange={(value) => {
          if (!value && !busy) setRemove(null);
        }}
        title={<>删除策略「{remove?.name}」？</>}
        description="删除库中的组合清单，已应用到工作目录的批次与产物保持不变。"
        cancel={{
          label: "取消",
          variant: "outline",
          disabled: busy,
          onClick: () => setRemove(null),
        }}
        confirm={{
          label: "删除",
          variant: "destructive-fill",
          disabled: busy,
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
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </DialogShell>
      <DialogShell
        open={repair !== null}
        onOpenChange={(value) => {
          if (!value && !busy) setRepair(null);
        }}
        title={<>重新指定「{repair?.name}」</>}
        description={repair?.missing_refs.join("；")}
        cancel={{
          label: "取消",
          variant: "outline",
          disabled: busy,
          onClick: () => setRepair(null),
        }}
        confirm={{
          label: "重新指定",
          disabled: busy || !bindings.endpoint_id || !bindings.prompt_id,
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
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
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
              {!endpoints.some((entry) => entry.id === bindings.endpoint_id) &&
                bindings.endpoint_id !== "" && (
                  <SelectItem value={bindings.endpoint_id} disabled>
                    {bindings.endpoint_id}（缺失）
                  </SelectItem>
                )}
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
              {!prompts.some((entry) => entry.id === bindings.prompt_id) &&
                bindings.prompt_id !== "" && (
                  <SelectItem value={bindings.prompt_id} disabled>
                    {bindings.prompt_id}（缺失）
                  </SelectItem>
                )}
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
