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
        // 全部技能都列出来（含已停用）——只列已启用时，用户在表单里根本
        // 看不见「还有什么可用」，想启用只能自己切去设置页猜。
        setSkills(skillItems);
        setEndpoint(endpointItems[0]?.name ?? "");
        setPrompt(promptItems[0]?.name ?? "");
        setLoaded(true);
      })
      .catch((reason: unknown) => {
        // 四表拉取失败：这里存原文供各字段区分「拉取失败」与「库里为空」（CfgPopSelect
        // 据此显「配置读取失败」而非「还没有可用的端点配置」）——故不走 reportError 的
        // 连接类→toast 分流（那会把失败塌成空、误报成「库里没有」）。
        if (current) setError(errorMessage(reason));
      });
    return () => {
      current = false;
    };
  }, []);

  /** 重拉四表（「重新指定」弹窗修好策略引用后：坏行当场回 healthy）。 */
  function reload(): void {
    void Promise.all([
      api.listStrategies(),
      api.listEndpoints(),
      api.listPrompts(),
      api.listSkills(),
    ]).then(([libraryItems, endpointItems, promptItems, skillItems]) => {
      setStrategies(libraryItems);
      setEndpoints(endpointItems);
      setPrompts(promptItems);
      setSkills(skillItems);
      setError("");
      setLoaded(true);
    });
  }

  return {
    strategies,
    endpoints,
    prompts,
    skills,
    loaded,
    error,
    setError,
    reload,
    endpoint,
    setEndpoint,
    prompt,
    setPrompt,
  };
}
