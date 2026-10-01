import { useEffect, useState } from "react";
import {
  api,
  type EndpointConfigSummary,
  errorMessage,
  type PromptInfo,
  type SkillInfo,
} from "../../../api";
import type { components } from "../../../api-types.gen";

/** NewBatchForm 的查询域收拢：策略库／端点／提示词／技能四列表挂载一次拉取＋端点与提示词默认选中。 */
export function useBatchFormLists() {
  const [strategies, setStrategies] = useState<components["schemas"]["StrategyView"][]>(
    [],
  );
  const [endpoints, setEndpoints] = useState<EndpointConfigSummary[]>([]);
  const [prompts, setPrompts] = useState<PromptInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    let current = true;
    void Promise.all([
      api.listStrategies(),
      api.listEndpoints(),
      api.listPrompts(),
      api.listSkills(),
    ])
      .then(([libraryItems, endpointItems, promptItems, skillItems]) => {
        if (!current) return;
        setStrategies(libraryItems);
        setEndpoints(endpointItems);
        setPrompts(promptItems);
        // V16：全部技能都列出来（含已停用）——只列已启用时，用户在表单里根本
        // 看不见「还有什么可用」，想启用只能自己切去设置页猜。
        setSkills(skillItems);
        setEndpoint(
          endpointItems.find((entry) => entry.is_active)?.name ??
            endpointItems[0]?.name ??
            "",
        );
        setPrompt(promptItems[0]?.name ?? "");
        setLoaded(true);
      })
      .catch((reason: unknown) => {
        if (current) setError(errorMessage(reason));
      });
    return () => {
      current = false;
    };
  }, []);

  return {
    strategies,
    endpoints,
    prompts,
    skills,
    loaded,
    error,
    setError,
    endpoint,
    setEndpoint,
    prompt,
    setPrompt,
  };
}
