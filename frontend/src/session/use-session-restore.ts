/**
 * 会话恢复域的数据 hook：收拢会话快照的取数与应用——启动恢复（认领 / 镜像 /
 * 死镜像对账）与快照的统一应用口（applySnapshot）。
 *
 * 桶状态（bucketRef）、用户动作计数（userActedRef）、进桶接续（attachBucket）与
 * SSE 发送链等命令类操作留在 ChatSessionProvider 调用点；本 hook 只拥有恢复
 * 生命周期。认领结论落回镜像键：本 hook 是认领的唯一发起方，boot 的请求面因此
 * 确定（E2E requests 基线不再竞速）。
 */
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useState,
} from "react";
import { ApiError, api } from "../api";
import { reportError } from "../lib/feedback";
import {
  chatInstructionKey,
  isStrategySelection,
  NEW_STRATEGY_ID,
  readStoredJson,
  readStoredString,
  WORKBENCH_STRATEGY_KEY,
  writeStoredJson,
} from "../lib/ui-storage";
import type { ChatMessage } from "./types";

type SessionSnapshot = Awaited<ReturnType<typeof api.latestSession>>;

/** 会话恢复进度：restored=已带回快照；empty=首次使用（404）；error=恢复失败。 */
export type ChatRestoreState = "pending" | "restored" | "empty" | "error";

/** 快照应用目标与恢复流程所需的共享状态写入口（全部为稳定引用）。 */
export interface SessionRestoreDeps {
  setSessionId: Dispatch<SetStateAction<string | null>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setSkillIds: Dispatch<SetStateAction<string[]>>;
  setInstructionState: Dispatch<SetStateAction<string>>;
  setChatErrorState: Dispatch<SetStateAction<string>>;
  /** 会话恢复前的用户动作计数（Provider 持有）：恢复落地时用户已经动过手，快照就是过时的。 */
  userActedRef: RefObject<number>;
  /** 当前会话桶（Provider 持有）：认领 / 镜像路径把结论写进它。 */
  bucketRef: RefObject<string>;
}

/**
 * 会话恢复的取数与应用。
 *
 * @param deps - 快照应用目标与恢复流程所需的状态写入口（Provider 持有；引用全部稳定）。
 * @returns 恢复进度状态与快照统一应用口——applySnapshot 供进桶接续（attachBucket）
 *          复用，restoreState / restoredPromptId 供页面按恢复结果衔接编辑器。
 */
export function useSessionRestore(deps: SessionRestoreDeps): {
  restoreState: ChatRestoreState;
  restoredPromptId: string | null;
  applySnapshot: (snapshot: SessionSnapshot) => void;
} {
  const {
    setSessionId,
    setMessages,
    setSkillIds,
    setInstructionState,
    setChatErrorState,
    userActedRef,
    bucketRef,
  } = deps;

  const [restoreState, setRestoreState] = useState<ChatRestoreState>("pending");
  const [restoredPromptId, setRestoredPromptId] = useState<string | null>(null);

  // 会话快照的统一应用口：启动恢复与切桶接续共用。历史附件直连会话附件端点（B5）：
  // 缩略图不再依赖内存 dataURL，刷新不丢。
  const applySnapshot = useCallback(
    (snapshot: SessionSnapshot): void => {
      setRestoredPromptId(snapshot.settings.prompt_id);
      setSessionId(snapshot.session_id);
      setSkillIds(snapshot.settings.skill_ids);
      setMessages(
        snapshot.messages.map((item, index) => ({
          ...item,
          id: index,
          ...(item.attachment !== null
            ? {
                attachmentUrl: api.sessionAttachmentUrl(
                  snapshot.session_id,
                  item.attachment,
                ),
              }
            : {}),
        })),
      );
      setRestoreState("restored");
    },
    [setMessages, setSessionId, setSkillIds],
  );

  // 启动恢复（会话归属 v3）：按策略镜像进桶——
  //   · 镜像键存在且指向策略 → 拉该桶最近会话接上（镜像指向已删策略时桶为空，
  //     404 即空白，恢复链不猜）；
  //   · 镜像键存在且为 null（用户停在新建策略态）→ 进 __new__ 桶；
  //   · 镜像键不存在（首启 / 清了站点数据）→ 认领：全局最新会话的归属命中什么
  //     桶就进什么桶（无归属的存量会话进 __new__——签名近似已退役，不猜不认错）。
  // 认领结论（含 404 / 新建态）一律落回镜像键：本 hook 是认领的唯一发起方，
  // 策略工具栏只等镜像键出现再按 id 恢复选中，不自己发请求——boot 的请求面因此
  // 确定（E2E requests 基线不再竞速）。
  useEffect(() => {
    let cancelled = false;
    const rawMirror = localStorage.getItem(WORKBENCH_STRATEGY_KEY);
    const mirror =
      rawMirror === null
        ? undefined
        : readStoredJson(WORKBENCH_STRATEGY_KEY, isStrategySelection);
    const settleMirror = (value: unknown): void => {
      if (!cancelled) writeStoredJson(WORKBENCH_STRATEGY_KEY, value);
    };
    void (async () => {
      try {
        if (mirror === undefined) {
          // 认领：全局最新会话的归属就是「上次工作的地方」。
          const latest = await api.latestSession();
          if (cancelled || userActedRef.current > 0) return;
          const owner = latest.strategy_id ?? NEW_STRATEGY_ID;
          bucketRef.current = owner;
          setInstructionState(readStoredString(chatInstructionKey(owner)) ?? "");
          settleMirror(
            owner === NEW_STRATEGY_ID
              ? null
              : {
                  id: owner,
                  name: "",
                  description: "",
                  // 字段名必须与 StrategySelection 契约一致（endpoint_id / prompt_id /
                  // skill_ids）：ID 化改字段名时漏了这里，写出的骨架过不了镜像校验、
                  // 工具栏永远读不回（2026-09-23 顺带修复）。
                  endpoint_id: "",
                  prompt_id: "",
                  skill_ids: [],
                },
          );
          applySnapshot(latest);
          return;
        }
        const owner = mirror?.id ?? NEW_STRATEGY_ID;
        const snapshot = await api.latestSession(owner);
        if (cancelled || userActedRef.current > 0) return;
        bucketRef.current = owner;
        setInstructionState(readStoredString(chatInstructionKey(owner)) ?? "");
        applySnapshot(snapshot);
      } catch (err) {
        if (cancelled || userActedRef.current > 0) return;
        const noSessionYet = err instanceof ApiError && err.status === 404;
        if (noSessionYet) {
          // 桶里还没有会话（或还没有任何会话）：空白起步，落镜像免得工具栏再等。
          if (mirror === undefined) {
            settleMirror(null);
          } else if (mirror !== null) {
            // 死镜像对账（2026-09-23）：镜像指向的策略已不在库里（界面外丢数据——
            // 删数据根 / 恢复备份）时，若不结算，boot 永远查死桶、新会话永远落
            // __new__ 默认桶，两桶永久错位，滚动保留随后把真历史当垃圾删掉（实锤：
            // 删 .dataset_factory 后重启，__new__ 桶历史被新会话首轮覆盖删除）。
            // 策略已不在 → 镜像结算回新建策略态；策略还在 → 只是这个桶还没聊过
            // 天，空白起步语义不变。
            const strategies = await api.listStrategies();
            if (cancelled || userActedRef.current > 0) return;
            if (!strategies.some((entry) => entry.id === mirror.id)) {
              settleMirror(null);
              bucketRef.current = NEW_STRATEGY_ID;
            }
          }
          setRestoreState("empty");
        } else {
          setChatErrorState(reportError(err) ?? "");
          setRestoreState("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applySnapshot, bucketRef, setChatErrorState, setInstructionState, userActedRef]);

  return {
    restoreState,
    restoredPromptId,
    applySnapshot,
  };
}
