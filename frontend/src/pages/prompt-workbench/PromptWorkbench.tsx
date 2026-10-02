/** 策略工作台：组合库、提示词编辑与对话调试。 */
import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { api } from "../../api";
import { TooltipProvider } from "../../components/ui/tooltip";
import { usePersistedState } from "../../hooks/use-persisted-state";
import type { Feedback } from "../../lib/feedback";
import { reportError } from "../../lib/feedback";
import {
  isWorkbenchEditorMirror,
  NEW_STRATEGY_ID,
  WORKBENCH_EDITOR_KEY,
  type WorkbenchEditorMirror,
} from "../../lib/ui-storage";
import { useChatSession } from "../../session/chat-session";
import { ChatColumn } from "./chat/ChatColumn";
import { EditorColumn } from "./editor/EditorColumn";
import { useWorkbenchLists } from "./hooks/use-workbench-lists";
import { StrategyToolbar } from "./strategy/StrategyToolbar";
import type { Strategy } from "./strategy/use-strategies";

export function PromptWorkbench({
  onNavigateToSettings,
}: {
  onNavigateToSettings: () => void;
}): ReactElement {
  // ---------- 列表与编辑器 ----------
  // 当前选中的提示词 ID（发送 / 策略应用直接用它；显示名单独存草稿）。
  const [selectedId, setSelectedId] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [savedPrompt, setSavedPrompt] = useState({
    id: "",
    name: "",
    description: "",
    body: "",
  });
  const [isNewDraft, setIsNewDraft] = useState(false);
  const [editorFeedback, setEditorFeedback] = useState<Feedback | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteName, setDeleteName] = useState("");
  const [promptMenuOpen, setPromptMenuOpen] = useState(false);
  const [promptBusy, setPromptBusy] = useState(false);
  const [strategyBusy, setStrategyBusy] = useState(false);
  // 端点 chip 的页内选中（ADR 2026-09-30「全局当前使用」退役）：纯会话内记忆、
  // 刷新复位——复位不是回默认值，而是随启动恢复的策略锚回它冻结的端点；
  // 没有策略选中时为空（chip 显示未配置端点，选端点属于新建组合的一部分）。
  const [selectedEndpointId, setSelectedEndpointId] = useState("");

  // ---------- 对话列（状态与逻辑住在 App 级会话域：切页卸载本组件不打断流式生成） ----------
  const {
    messages,
    streaming,
    copiedId,
    skillIds,
    instruction,
    media,
    sending,
    waitSeconds,
    chatError,
    restoreState,
    restoredPromptId,
    send,
    stopGeneration,
    newSession,
    clearConversation,
    attachBucket,
    assignActiveSession,
    toggleSkill,
    applySkillIds,
    setInstruction,
    pickMedia,
    setMediaFps,
    setMediaMaxFrames,
    clearMedia,
    copyCaption,
    setChatError,
  } = useChatSession();

  // ---------- 端点配置（页面职责：发送时刻把选中端点 / 提示词传给会话域） ----------
  // 会话恢复是否带回了基础提示词：带回了就不做「自动选中首条」（恢复优先于默认）。
  const restoredPromptRef = useRef(false);
  const promptRequestRef = useRef(0);
  const savingPromptRef = useRef(false);
  // 本轮保存已成功 rename 过的显示名（重试保存时防重复 rename；成功后清空）。
  const renamedToRef = useRef<string | null>(null);
  const interactionRef = useRef(0);

  // 编辑器状态镜像（跨重启）：选中提示词 + 未保存草稿合一键，恢复即视为
  // 最近一次用户意图。列表装载时按镜像分流（见下方启动分流）；镜像指向已删除的
  // 提示词则整段让位给快照 / 首条的既有链。
  const [editorMirror, setEditorMirror] =
    usePersistedState<WorkbenchEditorMirror | null>(
      WORKBENCH_EDITOR_KEY,
      null,
      isWorkbenchEditorMirror,
    );
  // 装载期读镜像走 ref：镜像状态随编辑变化高频更新，不能进装载 effect 的依赖。
  const editorMirrorRef = useRef<WorkbenchEditorMirror | null>(editorMirror);
  editorMirrorRef.current = editorMirror;

  /** 失败分流：连接类失败改弹浮层（不占界面位置），后端返回的业务错误仍就地展示。 */
  const failEditor = useCallback((err: unknown): void => {
    const text = reportError(err);
    if (text !== null) setEditorFeedback({ kind: "error", text });
  }, []);

  const {
    prompts,
    skills,
    endpoints,
    setPrompts,
    setSkills,
    setEndpoints,
    fetchAllLists,
    reloadPrompts,
  } = useWorkbenchLists(failEditor);

  // 端点选中的派生值（按 ID 现查）：选中指向已删配置（外部删除 / 策略引用悬空）时
  // 为 undefined——chip 显示未配置端点、发送与保存策略随之拦下，即「置空提示重选」。
  const selectedEndpoint = endpoints.find((item) => item.id === selectedEndpointId);

  const selectPrompt = useCallback(
    async (pid: string, options?: { resetSession?: boolean }): Promise<void> => {
      const request = ++promptRequestRef.current;
      const interaction = interactionRef.current;
      try {
        const full = await api.getPrompt(pid);
        if (
          request !== promptRequestRef.current ||
          interaction !== interactionRef.current
        )
          return;
        setSelectedId(full.id);
        setDraftName(full.name);
        setDraftDescription(full.description);
        setDraftBody(full.body);
        setSavedPrompt(full);
        setIsNewDraft(false);
        setEditorFeedback(null);
        if (options?.resetSession === true) {
          // 切提示词 = 下一轮换 system 底座（N1 同源③）：旧对话接着新配置只会
          // 让产出来源混乱——直接清空（桶不变，下轮发送的新会话仍记在当前桶名下；
          // 切回原提示词后的接续靠切桶，不靠签名猜测）。
          clearConversation();
        }
      } catch (err) {
        if (
          request !== promptRequestRef.current ||
          interaction !== interactionRef.current
        )
          return;
        failEditor(err);
      }
    },
    [clearConversation, failEditor],
  );

  useEffect(
    () => () => {
      promptRequestRef.current += 1;
      interactionRef.current += 1;
    },
    [],
  );

  // 编辑器状态镜像落盘（跨重启恢复「上次正在编辑什么」）：编辑器的每个动作都会
  // 走到这里，等价于持续镜像。空态不写——防止启动挂载的一帧空白把既有镜像冲掉
  // （镜像恢复发生在列表装载，若中途崩溃也最多退回「无镜像」的旧行为）。
  useEffect(() => {
    if (
      !isNewDraft &&
      selectedId === "" &&
      draftName === "" &&
      draftDescription === "" &&
      draftBody === ""
    ) {
      return;
    }
    setEditorMirror({
      selectedId,
      draftName,
      draftDescription,
      draftBody,
      savedPrompt,
      isNewDraft,
    });
  }, [
    isNewDraft,
    selectedId,
    draftName,
    draftDescription,
    draftBody,
    savedPrompt,
    setEditorMirror,
  ]);

  // 进页拉提示词 / skill / 端点配置三份列表；随后按优先级决定编辑器初始内容
  // （恢复优先级：编辑器镜像 > 会话快照 > 首条，ADR 2026-09-22）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const lists = await fetchAllLists();
        if (cancelled) {
          return;
        }
        setPrompts(lists.prompts);
        setSkills(lists.skills);
        setEndpoints(lists.endpoints);
        const mirror = editorMirrorRef.current;
        // 镜像优先（恢复优先级：编辑器镜像 > 会话快照 > 首条）：镜像 = 用户离开
        // 时刻的编辑器原样（选中 + 未保存草稿），比快照（最后一次发送时的配置）更新。
        // 恢复镜像视为用户动过手（interactionRef 递增），后端快照的提示词应用自此
        // 让位；会话内容的恢复由会话域按镜像与快照是否分叉另行对账（chat-session.tsx）。
        // 仅当镜像选中的提示词已从库里消失（外部删除）时，才整段让位给既有链。
        if (mirror?.isNewDraft) {
          restoredPromptRef.current = true;
          interactionRef.current += 1;
          setSelectedId("");
          setDraftName("");
          setDraftDescription("");
          setDraftBody("");
          setSavedPrompt({ id: "", name: "", description: "", body: "" });
          setIsNewDraft(true);
          setEditorFeedback(null);
          return;
        }
        if (mirror !== null) {
          const exists =
            mirror.selectedId !== "" &&
            lists.prompts.some((entry) => entry.id === mirror.selectedId);
          // 「无选中但有草稿」同样恢复：空白编辑器里直接打字的草稿也是用户意图。
          if (exists || mirror.selectedId === "") {
            restoredPromptRef.current = true;
            interactionRef.current += 1;
            setSelectedId(mirror.selectedId);
            setDraftName(mirror.draftName);
            setDraftDescription(mirror.draftDescription);
            setDraftBody(mirror.draftBody);
            setSavedPrompt(mirror.savedPrompt);
            setIsNewDraft(false);
            setEditorFeedback(null);
            return;
          }
          // 镜像指向已删除的提示词：整段让位，走下方快照 / 首条的既有链。
        }
        const first = lists.prompts[0];
        if (
          !restoredPromptRef.current &&
          interactionRef.current === 0 &&
          first !== undefined
        ) {
          await selectPrompt(first.id);
        }
      } catch (err) {
        if (!cancelled) {
          failEditor(err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectPrompt, failEditor, fetchAllLists, setPrompts, setSkills, setEndpoints]);

  // 会话恢复带回了基础提示词：带回了就不做「自动选中首条」（恢复优先于默认），
  // 也不覆盖用户已选 / 已编辑的草稿——用户动过手（interactionRef > 0）就让位。
  // 编辑器镜像恢复也会递增 interactionRef，所以「镜像存在」时这里自然让位。
  useEffect(() => {
    if (restoreState !== "restored") return;
    restoredPromptRef.current = true;
    if (restoredPromptId === null || interactionRef.current !== 0) return;
    void selectPrompt(restoredPromptId);
  }, [restoreState, restoredPromptId, selectPrompt]);

  const startNewDraft = (): void => {
    interactionRef.current += 1;
    promptRequestRef.current += 1;
    setSelectedId("");
    setDraftName("");
    setDraftDescription("");
    setDraftBody("");
    setSavedPrompt({ id: "", name: "", description: "", body: "" });
    setIsNewDraft(true);
    setPromptMenuOpen(false);
    setEditorFeedback(null);
  };

  /** 保存草稿：名称改动过 = 先重命名（改文件名）再写内容，旧名不再保留。 */
  const saveDraft = async (): Promise<void> => {
    if (savingPromptRef.current) return;
    const name = draftName.trim();
    if (name === "") {
      setEditorFeedback({ kind: "error", text: "名称不能为空；请填写提示词名称。" });
      return;
    }
    savingPromptRef.current = true;
    setPromptBusy(true);
    try {
      // ID 语义：新建走 POST（服务端分配 ID）；已有条目按 ID 覆盖，显示名变化
      // 用 rename 写 frontmatter（文件名是 ID、永不动，引用不受影响）。
      let pid = selectedId;
      if (isNewDraft || pid === "") {
        const created = await api.createPrompt({
          name,
          description: draftDescription,
          body: draftBody,
        });
        pid = created.id;
      } else {
        // rename 幂等跟踪：正文写入失败重试时不再重复 rename（savedPrompt.name
        // 保持旧值，让 promptDirty 仍为 true、保存按钮可点）。
        if (name !== savedPrompt.name && name !== renamedToRef.current) {
          await api.renamePrompt(pid, { new_name: name });
          renamedToRef.current = name;
        }
        await api.savePrompt(pid, {
          name,
          description: draftDescription,
          body: draftBody,
        });
      }
      setIsNewDraft(false);
      setSelectedId(pid);
      setDraftName(name);
      renamedToRef.current = null;
      setSavedPrompt({ id: pid, name, description: draftDescription, body: draftBody });
      setEditorFeedback({ kind: "success", text: `已保存提示词「${name}」` });
      await reloadPrompts();
    } catch (err) {
      failEditor(err);
    } finally {
      savingPromptRef.current = false;
      setPromptBusy(false);
    }
  };

  const deleteSelected = async (): Promise<void> => {
    if (deleteName === "" || savingPromptRef.current) {
      return;
    }
    savingPromptRef.current = true;
    setPromptBusy(true);
    try {
      await api.deletePrompt(deleteName);
      if (deleteName === selectedId) startNewDraft();
      setEditorFeedback({ kind: "success", text: `已删除「${deleteName}」` });
      setDeleteDialogOpen(false);
      await reloadPrompts();
    } catch (err) {
      failEditor(err);
    } finally {
      savingPromptRef.current = false;
      setPromptBusy(false);
    }
  };

  /** 选端点（页内局部选择器）：纯前端状态，没有激活调用——发送 / 保存策略取当前选中。 */
  const selectEndpoint = (cid: string): void => {
    interactionRef.current += 1;
    setChatError("");
    setSelectedEndpointId(cid);
  };

  /** 启动恢复认领了策略：chip 锚回该策略冻结的端点（未保存的 chip 改动随刷新作废）。 */
  const handleStrategyRestored = useCallback((strategy: Strategy): void => {
    setSelectedEndpointId(strategy.endpoint_id);
  }, []);

  const handleToggleSkill = (name: string): void => {
    if (sending || strategyBusy) return;
    interactionRef.current += 1;
    toggleSkill(name);
  };

  const handlePickMedia = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file !== undefined) {
      interactionRef.current += 1;
    }
    pickMedia(file);
  };

  /** 发送（配置侧收口）：忙态守卫在这里，会话域只管发送本身与重入守卫。 */
  const handleSend = (): void => {
    if (strategyBusy || promptBusy) return;
    if (selectedEndpoint === undefined) {
      // 契约必填（批1 起）：没有可选中的端点（未选 / 选中被删）就地拦下说清楚，
      // 不让请求打到后端吃一句原始报错。
      setChatError("请先在对话顶端选择端点配置。");
      return;
    }
    interactionRef.current += 1;
    send({
      promptId: selectedId === "" ? null : selectedId,
      activeModel: selectedEndpoint.model,
      endpointId: selectedEndpoint.id,
    });
  };

  // 中文输入法的回车上屏不属于「发送」（isComposing 判定），Shift+Enter 换行。
  const onInstructionKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      handleSend();
    }
  };

  const controlsBusy = sending || strategyBusy || promptBusy;
  const canSend = !controlsBusy && (instruction.trim() !== "" || media !== null);
  const promptDirty =
    isNewDraft ||
    draftName !== savedPrompt.name ||
    draftDescription !== savedPrompt.description ||
    draftBody !== savedPrompt.body;

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-col">
        <StrategyToolbar
          references={{
            endpoint_id: selectedEndpoint?.id ?? "",
            prompt_id: selectedId,
            skill_ids: skillIds,
          }}
          prompts={prompts}
          skills={skills}
          endpoints={endpoints}
          locked={promptDirty || controlsBusy}
          onSelect={async (strategy) => {
            interactionRef.current += 1;
            const request = ++promptRequestRef.current;
            setStrategyBusy(true);
            try {
              const full = await api.getPrompt(strategy.prompt_id);
              if (request !== promptRequestRef.current)
                throw new Error("当前编辑状态已改变，请重新选择策略");
              restoredPromptRef.current = true;
              setSelectedId(full.id);
              setDraftName(full.name);
              setDraftDescription(full.description);
              setDraftBody(full.body);
              setSavedPrompt(full);
              setIsNewDraft(false);
              applySkillIds(strategy.skill_ids);
              // 选策略随跳：chip 锚到该策略冻结的端点（页内选中，无激活调用）。
              setSelectedEndpointId(strategy.endpoint_id);
              // 切策略 = 换端点 + 提示词 + Skill 的整套口径（N1 同源③）。会话处理
              // （v3，归属即身份）：进该策略的桶——拉它名下最近会话接上（「切走
              // 再切回」不丢历史），桶里还没有会话就空白起步。
              applySkillIds(strategy.skill_ids);
              attachBucket(strategy.id);
            } finally {
              setStrategyBusy(false);
            }
          }}
          onNewStrategy={() => attachBucket(NEW_STRATEGY_ID)}
          onStrategySaved={(strategy) => assignActiveSession(strategy.id)}
          onRestored={handleStrategyRestored}
        />
        <fieldset
          // N1④（2026-09-21 审计）：发送中只锁配置类操作、不锁整页——「能打字 /
          // 能挂附件 / 能切端点」是等待 125 秒时最基本的自由；sending 不再参与禁用。
          disabled={strategyBusy || promptBusy}
          className="grid min-h-0 min-w-0 flex-1 grid-cols-1 overflow-auto lg:grid-cols-2 lg:overflow-hidden"
        >
          <EditorColumn
            prompts={prompts}
            promptMenuOpen={promptMenuOpen}
            onPromptMenuOpenChange={setPromptMenuOpen}
            draftName={draftName}
            onDraftNameInput={(value) => {
              interactionRef.current += 1;
              setDraftName(value);
            }}
            draftDescription={draftDescription}
            onDraftDescriptionInput={(value) => {
              interactionRef.current += 1;
              setDraftDescription(value);
            }}
            draftBody={draftBody}
            onDraftBodyChange={(body) => {
              interactionRef.current += 1;
              setDraftBody(body);
            }}
            promptDirty={promptDirty}
            onNewDraft={startNewDraft}
            onSelectPrompt={(name) => {
              interactionRef.current += 1;
              setPromptMenuOpen(false);
              void selectPrompt(name, { resetSession: true });
            }}
            onDeletePromptRequest={(name) => {
              setDeleteName(name);
              setDeleteDialogOpen(true);
              setPromptMenuOpen(false);
            }}
            onSave={() => void saveDraft()}
            editorFeedback={editorFeedback}
            deleteDialogOpen={deleteDialogOpen}
            onDeleteDialogOpenChange={setDeleteDialogOpen}
            deleteName={deleteName}
            onDeleteConfirm={() => void deleteSelected()}
          />

          <ChatColumn
            endpoints={endpoints}
            selectedEndpointId={selectedEndpointId}
            skills={skills}
            skillIds={skillIds}
            disabled={strategyBusy || promptBusy}
            controlsBusy={controlsBusy}
            canSend={canSend}
            messages={messages}
            streaming={streaming}
            waitSeconds={waitSeconds}
            copiedId={copiedId}
            chatError={chatError}
            instruction={instruction}
            media={media}
            sending={sending}
            onSelectEndpoint={selectEndpoint}
            onManageEndpoints={onNavigateToSettings}
            onNewSession={() => {
              interactionRef.current += 1;
              newSession();
            }}
            onCopy={copyCaption}
            onToggleSkill={handleToggleSkill}
            onInstructionChange={(value) => {
              interactionRef.current += 1;
              setInstruction(value);
            }}
            onInstructionKeyDown={onInstructionKeyDown}
            onPickMedia={handlePickMedia}
            onMediaFpsChange={setMediaFps}
            onMediaMaxFramesChange={setMediaMaxFrames}
            onClearMedia={clearMedia}
            onSend={handleSend}
            onStop={stopGeneration}
          />
        </fieldset>
      </div>
    </TooltipProvider>
  );
}
