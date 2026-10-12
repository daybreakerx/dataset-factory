import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../api";
import type { components } from "../../../api-types.gen";
import {
  CfgPopFieldRow,
  CfgPopMultiSelect,
  CfgPopSelect,
} from "../../../components/cfg-pop";
import { DialogShell } from "../../../components/dialog-shell";
import { DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { Tip } from "../../../components/ui/tooltip";

type StrategyView = components["schemas"]["StrategyView"];

/**
 * 「重新指定」弹窗（策略下拉稿两格 480；2026-10-13 E4 补建——原「新功能」定性订正为
 * 稿定欠账：稿面与用户既有定案早已定死形态与行为，批内未做＝施工没做完）。
 *
 * 修策略的缺失引用（端点／提示词／Skill）：健康的引用位预选现值，坏掉的位初始空
 * （稿「不预选悬空值」）；Skill 组里缺失项列名带「（缺失或停用）」后缀、不可勾。
 * 提交走既有 `POST /api/strategies/{id}/rebind`（只动提供的引用位），成功后回 healthy。
 * 提交失败落标题行右侧消息槽（alert 轮 A″：`.modal-head-note--bad` 同槽——单行省略、
 * 悬停给全文），不关弹窗、可原地重试；退出路径＝Esc／取消／关闭叉（点内容之外不关）。
 */
export function RepointStrategyDialog({
  strategy,
  onClose,
  onRepointed,
}: {
  strategy: StrategyView;
  onClose: () => void;
  onRepointed: (updated: StrategyView) => void;
}) {
  const [endpoints, setEndpoints] = useState<
    Awaited<ReturnType<typeof api.listEndpoints>>
  >([]);
  const [prompts, setPrompts] = useState<Awaited<ReturnType<typeof api.listPrompts>>>(
    [],
  );
  const [skills, setSkills] = useState<Awaited<ReturnType<typeof api.listSkills>>>([]);
  const [loadError, setLoadError] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [prompt, setPrompt] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lifetime = useRef<object | null>(null);

  useEffect(() => {
    const current = {};
    lifetime.current = current;
    setLoadError("");
    void Promise.all([api.listEndpoints(), api.listPrompts(), api.listSkills()]).then(
      ([endpointItems, promptItems, skillItems]) => {
        if (lifetime.current !== current) return;
        setEndpoints(endpointItems);
        setPrompts(promptItems);
        setSkills(skillItems);
        // 初值：健康的引用位预选现值、坏掉的位留空（稿「不预选悬空值」）。
        setEndpoint(
          (value) =>
            value ||
            (endpointItems.some((entry) => entry.id === strategy.endpoint_id)
              ? strategy.endpoint_id
              : ""),
        );
        setPrompt(
          (value) =>
            value ||
            (promptItems.some((entry) => entry.id === strategy.prompt_id)
              ? strategy.prompt_id
              : ""),
        );
        setSelected(
          strategy.skill_ids.filter((sid) =>
            skillItems.some((entry) => entry.id === sid),
          ),
        );
      },
      (reason: unknown) => {
        if (lifetime.current === current) setLoadError(errorMessage(reason));
      },
    );
    return () => {
      lifetime.current = null;
    };
  }, [strategy]);

  // 缺失的 Skill 引用（库里已不存在）：列名带后缀、不可勾（稿样图格 1 的灰项）。
  const missingSkills = strategy.skill_ids
    .map((sid, index) => ({
      sid,
      name: (strategy.skill_names ?? [])[index] || sid,
    }))
    .filter((entry) => !skills.some((item) => item.id === entry.sid));
  const skillOptions = [
    ...skills
      .filter((entry) => entry.enabled)
      .map((entry) => ({ value: entry.id, name: entry.name, desc: entry.description })),
    ...missingSkills.map((entry) => ({
      value: entry.sid,
      name: `${entry.name}（缺失或停用）`,
      disabled: true,
    })),
  ];
  const skillName = (value: string): string =>
    skills.find((entry) => entry.id === value)?.name ?? value;
  // 确认钮：两个必填引用位都选到现存资产才亮（Skill 可空）。
  const valid = endpoint !== "" && prompt !== "";
  const stateText = loadError
    ? `${loadError}——关掉再开此层可重试`
    : endpoints.length === 0 && prompts.length === 0
      ? "正在读取资产库"
      : "";

  async function repoint(): Promise<void> {
    if (busy || !valid) return;
    setBusy(true);
    setError("");
    try {
      const updated = await api.rebindStrategy(strategy.id, {
        endpoint_id: endpoint,
        prompt_id: prompt,
        skill_ids: selected,
      });
      onRepointed(updated);
    } catch (reason) {
      setError(errorMessage(reason));
      setBusy(false);
    }
  }

  return (
    <DialogShell
      open
      onOpenChange={(open) => !open && onClose()}
      className="max-h-[90vh] w-[min(var(--w-modal-480),calc(100vw-48px))] overflow-y-auto"
      cancel={{ label: "取消", onClick: onClose }}
      confirm={{
        label: "重新指定",
        disabled: !valid,
        flight: busy,
        onClick: () => void repoint(),
      }}
    >
      {/* 标题行：题＋缺失说明行＋失败消息槽（A″：标题行右侧红字、单行省略、悬停全文）。 */}
      <DialogHeader className="flex-row items-baseline gap-3 space-y-0 pr-[42px]">
        <DialogTitle className="flex-none">重新指定「{strategy.name}」</DialogTitle>
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
      {strategy.missing_refs.length > 0 && (
        <p className="text-t-sm text-text-2">
          {strategy.missing_refs.map((line) => `${line}。`).join("")}
        </p>
      )}
      {stateText !== "" && (
        <p role="status" className="text-t-sm text-text-3">
          {stateText}
        </p>
      )}
      <div className="flex min-w-0 flex-col gap-3">
        <CfgPopFieldRow label="端点">
          <CfgPopSelect
            ariaLabel="端点"
            head={null}
            value={endpoint}
            inert={busy}
            placeholder="选择端点"
            options={endpoints.map((entry) => ({
              value: entry.id,
              name: `${entry.name} · ${entry.model}`,
            }))}
            emptyText={stateText || "还没有可用的端点配置"}
            onSelect={setEndpoint}
          />
        </CfgPopFieldRow>
        <CfgPopFieldRow label="提示词">
          <CfgPopSelect
            ariaLabel="提示词"
            head={null}
            value={prompt}
            inert={busy}
            placeholder="选择提示词"
            options={prompts.map((entry) => ({ value: entry.id, name: entry.name }))}
            emptyText={stateText || "还没有可用的基础提示词"}
            onSelect={setPrompt}
          />
        </CfgPopFieldRow>
        <CfgPopFieldRow label="Skill">
          <CfgPopMultiSelect
            ariaLabel="Skill"
            head={null}
            options={skillOptions}
            selected={selected}
            text={selected.map(skillName).join("、") || "未选"}
            emptyText={stateText || "还没有可用的 Skill"}
            inert={busy}
            onToggle={(value) =>
              setSelected((previous) =>
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
