import { useEffect, useId, useRef, useState } from "react";
import { api, errorMessage } from "../../../api";
import type { components } from "../../../api-types.gen";
import {
  CfgPopFieldRow,
  CfgPopMultiSelect,
  CfgPopSelect,
} from "../../../components/cfg-pop";
import { DialogShell } from "../../../components/dialog-shell";
import { DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Tip } from "../../../components/ui/tooltip";

type Catalog = {
  strategies: Awaited<ReturnType<typeof api.listStrategies>>;
  endpoints: Awaited<ReturnType<typeof api.listEndpoints>>;
  prompts: Awaited<ReturnType<typeof api.listPrompts>>;
  skills: Awaited<ReturnType<typeof api.listSkills>>;
};

/**
 * 新增策略弹窗（稿 #18，14 格；600 档壳实例）。
 *
 * 两挂载点同实例、只有创建成功后的去向不同（打标页＝新批次自动选中；工作目录设置＝只重拉
 * 本页）。取数中的等待与失败都只写在弹层内一行（笔⑦）——**重开弹层即重拉＝重试**，
 * 所以这里不再摆表单级进度行与页脚重试钮；创建失败落标题行右侧消息槽（笔④）。
 */
export function NewStrategyDialog({
  wid,
  title,
  nextSeq,
  onClose,
  onCreated,
  onNavigateToSettings,
  onOpenWorkbench,
}: {
  wid: string;
  title: string;
  /** 本工作目录下一个可用批次序号（= 既有批次最大 seq + 1），名框标签旁那一处。 */
  nextSeq: number;
  onClose: () => void;
  onCreated: (batch: components["schemas"]["BatchView"]) => void;
  /** 齿轮＝跳该库管理处**且不关本窗**（格 5 裁甲；打标页由 `<Activity>` 保活，切回时列表重拉）。 */
  onNavigateToSettings?: () => void;
  /** 提示词那枚齿轮的去处＝策略页（在那里新建，保存后自动同步到此处）。 */
  onOpenWorkbench?: () => void;
}) {
  const id = useId();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState("");
  const [library, setLibrary] = useState("scratch");
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [prompt, setPrompt] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const completed = useRef(false);
  const lifetime = useRef<object | null>(null);

  function loadCatalog(): void {
    const current = {};
    lifetime.current = current;
    setLoadError("");
    void Promise.all([
      api.listStrategies(),
      api.listEndpoints(),
      api.listPrompts(),
      api.listSkills(),
    ]).then(
      ([strategies, endpoints, prompts, availableSkills]) => {
        if (lifetime.current !== current) return;
        setCatalog({
          strategies,
          endpoints,
          prompts,
          skills: availableSkills.filter((entry) => entry.enabled),
        });
        setEndpoint((value) => value || endpoints[0]?.id || "");
        setPrompt((value) => value || prompts[0]?.id || "");
      },
      (reason: unknown) => {
        if (lifetime.current === current) setLoadError(errorMessage(reason));
      },
    );
  }

  // 只在开窗那一次拉四张库表；此后**每次开弹层都重拉一遍**（笔⑦「重开弹层即重拉＝重试」，
  // 连带格 5 裁甲「齿轮跳去建端点、切回来列表已重拉」——两条同一机制）。
  // 取最新闭包用 ref 承接（先例＝WorkdirSettings 的 `refresh`），免得为「跑一次」写依赖豁免。
  const load = useRef(loadCatalog);
  load.current = loadCatalog;

  useEffect(() => {
    load.current();
    return () => {
      lifetime.current = null;
    };
  }, []);

  const scratch = library === "scratch";
  const source = catalog?.strategies.find((entry) => entry.id === library);
  const skillName = (value: string): string =>
    catalog?.skills.find((entry) => entry.id === value)?.name ?? value;
  const shownSkillIds = scratch ? skills : (source?.skill_ids ?? []);
  const valid =
    !!catalog &&
    (scratch ? !!name.trim() && !!endpoint && !!prompt : !!source?.available);
  // 等待与失败只在弹层里那一行说话（笔⑦＋§17 族「同一行的三态轮换」）。
  const stateText = loadError
    ? `${loadError}——关掉再开此层可重试`
    : catalog === null
      ? "正在读取策略配置"
      : "";
  const libraryValue = source?.endpoint_id ?? endpoint;
  const promptValue = source?.prompt_id ?? prompt;

  async function create() {
    if (pending.current || completed.current || !valid) return;
    const current = lifetime.current;
    pending.current = true;
    setBusy(true);
    setError("");
    let batch: components["schemas"]["BatchView"];
    try {
      batch = await api.createBatch(
        wid,
        scratch
          ? {
              type: "scratch",
              name: name.trim(),
              endpoint_id: endpoint,
              prompt_id: prompt,
              skill_ids: skills,
            }
          : { type: "library", id: library, name: name.trim() || null },
      );
    } catch (reason) {
      if (lifetime.current === current) setError(errorMessage(reason));
      setBusy(false);
      pending.current = false;
      return;
    }
    completed.current = true;
    if (lifetime.current === current) onCreated(batch);
  }

  return (
    <DialogShell
      open
      // 飞行期不拦退出（笔⑨，格 9 裁甲）：关掉的是界面、不撤销已发出的请求。
      onOpenChange={(open) => !open && onClose()}
      className="max-h-[90vh] w-[min(var(--w-modal-600),calc(100vw-48px))] overflow-y-auto"
      cancel={{ label: "取消", onClick: onClose }}
      confirm={{
        label: "创建策略",
        disabled: !valid,
        flight: busy,
        onClick: () => void create(),
      }}
    >
      {/* 标题行（稿 .ns-head）：基线对齐、不折行——副题与失败行都在行内自己省略，
          不整块顶到第二行；副题写在标题行内＝不算正文段，页脚因此无线（笔⑥）。 */}
      <DialogHeader className="flex-row items-baseline gap-3 space-y-0 pr-[42px]">
        <DialogTitle className="flex-none">新增策略</DialogTitle>
        <Tip label={`工作目录：${title}`}>
          <span className="min-w-0 flex-1 truncate text-t-sm text-text-3">
            工作目录：{title}
          </span>
        </Tip>
        {error !== "" && (
          <Tip label={error}>
            <span
              role="alert"
              className="min-w-[14em] flex-1 truncate text-t-sm text-bad-ink"
            >
              {error}
            </span>
          </Tip>
        )}
      </DialogHeader>
      <label
        htmlFor={`${id}-library`}
        className="mb-1 block text-t-md font-medium text-text-1"
      >
        策略来源
      </label>
      <CfgPopSelect
        ariaLabel="策略来源"
        head={null}
        value={library}
        inert={busy}
        onReopen={loadCatalog}
        onSelect={(value) => {
          setLibrary(value);
          setName(catalog?.strategies.find((entry) => entry.id === value)?.name ?? "");
        }}
        options={[
          {
            value: "scratch",
            name: "从零配置",
            desc: "端点、提示词与 Skill 在下面自己选",
          },
          ...(catalog?.strategies ?? []).map((entry) => ({
            value: entry.id,
            name: entry.name,
            // 坏行（笔⑭）：红缀短式＋去处句第二行，本窗不给处置出口（弹窗不叠弹窗）。
            desc: entry.available
              ? [
                  entry.endpoint_name,
                  entry.prompt_name,
                  `Skill ${entry.skill_ids.length}`,
                ].join(" ｜ ")
              : "不可应用 · 到「策略」页重新指定后可用",
            bad: !entry.available,
            badge: entry.available ? undefined : "引用缺失",
            disabled: !entry.available,
          })),
        ]}
        emptyText={stateText || "还没有可用的策略"}
      />
      <div className="mb-1 mt-4 flex items-baseline gap-2">
        <label htmlFor={`${id}-name`} className="text-t-md font-medium text-text-1">
          策略名
        </label>
        <span className="min-w-0 flex-1 truncate text-t-xs text-text-3">
          {`将分配序号 s${nextSeq}`}
        </span>
      </div>
      <Input
        id={`${id}-name`}
        value={name}
        placeholder="例如：标签式短句"
        // 飞行期只失效不换装（笔⑧）：不挂原生 disabled（那会进灰阶），改只读＋掐指针。
        readOnly={busy}
        aria-disabled={busy || undefined}
        className={busy ? "pointer-events-none" : undefined}
        onChange={(event) => setName(event.currentTarget.value)}
      />
      <div className="mb-1 mt-4 text-t-md font-medium text-text-1">策略内容</div>
      {/* 组卡与三行（笔③）：与新建批次策略段同一套类（§22 .nb-strat-group／.nb-sline）。 */}
      <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-border px-4 py-3">
        <CfgPopFieldRow label="端点配置">
          <CfgPopSelect
            ariaLabel="端点配置"
            head={{
              label: "端点",
              manageLabel: "前往设置 · 端点配置",
              onManage: onNavigateToSettings,
            }}
            value={libraryValue}
            disabled={!scratch}
            inert={busy}
            onReopen={loadCatalog}
            onSelect={setEndpoint}
            options={(catalog?.endpoints ?? []).map((entry) => ({
              value: entry.id,
              name: `${entry.name} · ${entry.model}`,
            }))}
            emptyText={stateText || "还没有可用的端点配置"}
          />
        </CfgPopFieldRow>
        <CfgPopFieldRow label="基础提示词">
          <CfgPopSelect
            ariaLabel="基础提示词"
            head={{
              label: "提示词",
              manageLabel: "前往策略页新建提示词，保存后自动同步到此处",
              onManage: onOpenWorkbench,
            }}
            value={promptValue}
            disabled={!scratch}
            inert={busy}
            onReopen={loadCatalog}
            onSelect={setPrompt}
            options={(catalog?.prompts ?? []).map((entry) => ({
              value: entry.id,
              name: entry.name,
            }))}
            emptyText={stateText || "还没有可用的基础提示词"}
          />
        </CfgPopFieldRow>
        <CfgPopFieldRow label="Skill">
          <CfgPopMultiSelect
            ariaLabel="Skill"
            head={{
              label: "Skill 库",
              manageLabel: "前往设置 · 技能",
              onManage: onNavigateToSettings,
            }}
            options={(catalog?.skills ?? []).map((entry) => ({
              value: entry.id,
              name: entry.name,
              desc: entry.description,
            }))}
            selected={shownSkillIds}
            text={shownSkillIds.map(skillName).join("、") || "未选"}
            emptyText={stateText || "还没有可用的 Skill"}
            disabled={!scratch}
            inert={busy}
            onReopen={loadCatalog}
            onToggle={(value) =>
              setSkills((previous) =>
                previous.includes(value)
                  ? previous.filter((entry) => entry !== value)
                  : [...previous, value],
              )
            }
          />
        </CfgPopFieldRow>
      </div>
    </DialogShell>
  );
}
