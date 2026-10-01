/**
 * 工作台页面的数据 hook：收拢查询类调用（提示词 / Skill / 端点配置三份列表的
 * boot 并行取数与提示词列表刷新）。
 * 命令类调用（提示词 CRUD、端点激活）留在页面调用点，不在这里包装。
 */

import type { Dispatch, SetStateAction } from "react";
import { useCallback, useState } from "react";
import type { EndpointConfigSummary, PromptInfo, SkillInfo } from "../../../api";
import { api } from "../../../api";

/** 查询失败的处理回调（连接类失败走浮层、业务错误就地展示的分流由调用方定义）。 */
type FailFeedback = (err: unknown) => void;

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
 * @returns 列表状态与维护入口；fetchAllLists 为纯取数（boot effect 保留取消链与
 *          装载时序的完整控制），reloadPrompts 供命令后刷新提示词列表。
 */
export function useWorkbenchLists(failFeedback: FailFeedback): {
  prompts: PromptInfo[];
  skills: SkillInfo[];
  endpoints: EndpointConfigSummary[];
  activeModel: string;
  setPrompts: Dispatch<SetStateAction<PromptInfo[]>>;
  setSkills: Dispatch<SetStateAction<SkillInfo[]>>;
  setEndpoints: Dispatch<SetStateAction<EndpointConfigSummary[]>>;
  setActiveModel: Dispatch<SetStateAction<string>>;
  fetchAllLists: () => Promise<WorkbenchLists>;
  reloadPrompts: () => Promise<void>;
} {
  const [prompts, setPrompts] = useState<PromptInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [endpoints, setEndpoints] = useState<EndpointConfigSummary[]>([]);
  const [activeModel, setActiveModel] = useState("");

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

  return {
    prompts,
    skills,
    endpoints,
    activeModel,
    setPrompts,
    setSkills,
    setEndpoints,
    setActiveModel,
    fetchAllLists,
    reloadPrompts,
  };
}
