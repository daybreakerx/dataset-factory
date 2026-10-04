/**
 * 端点配置面板的数据 hook：收拢查询类调用（配置列表及其 reload），供面板各区块共享。
 * 命令类调用（创建 / 更新 / 删除 / 测试连接）留在面板调用点，不在这里包装。
 */
import { useCallback, useState } from "react";
import type { EndpointConfigSummary } from "../../../api";
import { api } from "../../../api";
import { reportError } from "../../../lib/feedback";

/**
 * 端点配置列表查询：暴露当前列表与手动 reload（保存 / 删除等命令后由面板刷新列表）。
 * 失败分流＝只接非连接类置列表失败态（连接类由 reportError 改走浮层、后端原文不进界面，
 * 见 components/list.md「列表列的三态」）；取数中单独表达，不拿空态顶。
 *
 * @returns 列表状态（含取数中／取数失败标志）与 reload；reload 返回本次拉到的列表（失败返回空数组）。
 */
export function useEndpointConfigs(): {
  endpoints: EndpointConfigSummary[];
  loading: boolean;
  loadError: boolean;
  reload: () => Promise<EndpointConfigSummary[]>;
} {
  const [endpoints, setEndpoints] = useState<EndpointConfigSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const reload = useCallback(async (): Promise<EndpointConfigSummary[]> => {
    setLoading(true);
    try {
      const list = await api.listEndpoints();
      setEndpoints(list);
      setLoadError(false);
      return list;
    } catch (err) {
      if (reportError(err) !== null) {
        setLoadError(true);
      }
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  return { endpoints, loading, loadError, reload };
}
