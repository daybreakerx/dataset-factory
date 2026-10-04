/**
 * 工作台页面的数据 hook：收拢查询类调用（提示词 / Skill / 端点配置三份列表的
 * boot 并行取数与各列表的「打开弹层即重拉」）。
 * 命令类调用（提示词 CRUD）留在页面调用点，不在这里包装。
 */
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useState } from "react";
import type { EndpointConfigSummary, PromptInfo, SkillInfo } from "../../../api";
import { api } from "../../../api";
import { reportError } from "../../../lib/feedback";

/** 查询失败的处理回调（连接类失败走浮层、业务错误就地展示的分流由调用方定义）。 */
type FailFeedback = (err: unknown) => void;

/** 列表查询态（弹层三态行的数据源）：loading＝取数中；failed＝非连接类取数失败。 */
export type ListQuery = { loading: boolean; failed: boolean };

const IDLE_QUERY: ListQuery = { loading: false, failed: false };

/** 三份列表的一次性并行取数结果（boot 装载用）。 */
type WorkbenchLists = {
  prompts: PromptInfo[];
  skills: SkillInfo[];
  endpoints: EndpointConfigSummary[];
};

/**
 * 工作台三份列表的查询与状态。
 *
 * @param failFeedback - reloadPrompts 失败时的反馈回调。
 * @returns 列表状态与维护入口；三个 refresh 为弹层「打开即重拉」入口（打开＝重试——
 *          连接类失败走浮层提示、不落层内状态；业务失败落 failed，层内一行「〈对象〉读取失败」；
 *          重拉期间有旧数据时保旧静默、无旧数据时层内出「正在读取…」行）。
 */
export function useWorkbenchLists(failFeedback: FailFeedback): {
  prompts: PromptInfo[];
  skills: SkillInfo[];
  endpoints: EndpointConfigSummary[];
  setPrompts: Dispatch<SetStateAction<PromptInfo[]>>;
  setSkills: Dispatch<SetStateAction<SkillInfo[]>>;
  setEndpoints: Dispatch<SetStateAction<EndpointConfigSummary[]>>;
  promptsQuery: ListQuery;
  skillsQuery: ListQuery;
  endpointsQuery: ListQuery;
  fetchAllLists: () => Promise<WorkbenchLists>;
  reloadPrompts: () => Promise<void>;
  refreshPrompts: () => Promise<void>;
  refreshSkills: () => Promise<void>;
  refreshEndpoints: () => Promise<void>;
} {
  const [prompts, setPrompts] = useState<PromptInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [endpoints, setEndpoints] = useState<EndpointConfigSummary[]>([]);
  const [promptsQuery, setPromptsQuery] = useState<ListQuery>(IDLE_QUERY);
  const [skillsQuery, setSkillsQuery] = useState<ListQuery>(IDLE_QUERY);
  const [endpointsQuery, setEndpointsQuery] = useState<ListQuery>(IDLE_QUERY);

  const fetchAllLists = useCallback(async (): Promise<WorkbenchLists> => {
    const [promptList, skillList, endpointList] = await Promise.all([
      api.listPrompts(),
      api.listSkills(),
      api.listEndpoints(),
    ]);
    return { prompts: promptList, skills: skillList, endpoints: endpointList };
  }, []);

  const reloadPrompts = useCallback(async (): Promise<void> => {
    try {
      setPrompts(await api.listPrompts());
    } catch (err) {
      failFeedback(err);
    }
  }, [failFeedback]);

  const refreshPrompts = useCallback(async (): Promise<void> => {
    setPromptsQuery((state) => ({ ...state, loading: true }));
    try {
      setPrompts(await api.listPrompts());
      setPromptsQuery(IDLE_QUERY);
    } catch (err) {
      setPromptsQuery({ loading: false, failed: reportError(err) !== null });
    }
  }, []);

  const refreshSkills = useCallback(async (): Promise<void> => {
    setSkillsQuery((state) => ({ ...state, loading: true }));
    try {
      setSkills(await api.listSkills());
      setSkillsQuery(IDLE_QUERY);
    } catch (err) {
      setSkillsQuery({ loading: false, failed: reportError(err) !== null });
    }
  }, []);

  const refreshEndpoints = useCallback(async (): Promise<void> => {
    setEndpointsQuery((state) => ({ ...state, loading: true }));
    try {
      setEndpoints(await api.listEndpoints());
      setEndpointsQuery(IDLE_QUERY);
    } catch (err) {
      setEndpointsQuery({ loading: false, failed: reportError(err) !== null });
    }
  }, []);

  return {
    prompts,
    skills,
    endpoints,
    setPrompts,
    setSkills,
    setEndpoints,
    promptsQuery,
    skillsQuery,
    endpointsQuery,
    fetchAllLists,
    reloadPrompts,
    refreshPrompts,
    refreshSkills,
    refreshEndpoints,
  };
}
