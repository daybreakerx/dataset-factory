/**
 * 端点配置面板的数据 hook：收拢查询类调用（配置列表及其 reload），供面板各区块共享。
 * 命令类调用（创建 / 更新 / 删除 / 测试连接）留在面板调用点，不在这里包装。
 */
import { useCallback, useState } from "react";
import type { EndpointConfigSummary } from "../../../api";
import { api } from "../../../api";

/** 查询失败的处理回调（连接类失败走浮层、业务错误就地展示的分流由调用方定义）。 */
type FailFeedback = (err: unknown) => void;

/**
 * 端点配置列表查询：暴露当前列表与手动 reload（保存 / 删除等命令后由面板刷新列表）。
 *
 * @param failFeedback - 查询失败时的反馈回调（与面板各命令共用同一分流）。
 * @returns 列表状态与 reload；reload 返回本次拉到的列表（失败返回空数组）。
 */
export function useEndpointConfigs(failFeedback: FailFeedback): {
  endpoints: EndpointConfigSummary[];
  reload: () => Promise<EndpointConfigSummary[]>;
} {
  const [endpoints, setEndpoints] = useState<EndpointConfigSummary[]>([]);

  const reload = useCallback(async (): Promise<EndpointConfigSummary[]> => {
    try {
      const list = await api.listEndpoints();
      setEndpoints(list);
      return list;
    } catch (err) {
      failFeedback(err);
      return [];
    }
  }, [failFeedback]);

  return { endpoints, reload };
}
