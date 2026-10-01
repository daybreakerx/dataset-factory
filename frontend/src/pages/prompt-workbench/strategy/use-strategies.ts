/**
 * 策略工具条的数据 hook：收拢查询类调用（策略库列表：挂载即拉，此后每次打开下拉重拉），
 * 供工具条与策略库下拉区块共享。
 * 命令类调用（保存 / 复制 / 删除 / 重新指定）留在工具条调用点，不在这里包装。
 */

import type { Dispatch, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../api";
import type { components } from "../../../api-types.gen";
import { reportError } from "../../../lib/feedback";

export type Strategy = components["schemas"]["StrategyView"];

/**
 * 策略库列表查询：挂载即拉（启动恢复 v2——boot 要恢复「我在哪个策略里」，不能等首次
 * 打开下拉），此后每次打开下拉重拉一份；关闭后跳过（保留当前清单），取消链随
 * 依赖变化级联（旧响应迟到不覆盖新清单，见 StrictMode 用例）。
 *
 * @param open - 策略库下拉的展开态，重拉时机跟着它走。
 * @returns 列表与查询生命周期状态；setEntries / setError 供命令后的清单与错误维护，
 *          fetchList 供「刷新策略库」按钮走工具条自身的飞行守卫。
 */
export function useStrategies(open: boolean): {
  entries: Strategy[];
  loading: boolean;
  error: string;
  setEntries: Dispatch<SetStateAction<Strategy[]>>;
  setError: Dispatch<SetStateAction<string>>;
  fetchList: () => Promise<Strategy[]>;
} {
  const [entries, setEntries] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const firstLoad = useRef(true);

  useEffect(() => {
    if (!open && !firstLoad.current) return;
    firstLoad.current = false;
    let cancelled = false;
    setLoading(true);
    void api
      .listStrategies()
      .then((list) => {
        if (!cancelled) {
          setEntries(list);
          setError("");
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setEntries([]);
          setError(reportError(err) ?? "");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const fetchList = (): Promise<Strategy[]> => api.listStrategies();

  return { entries, loading, error, setEntries, setError, fetchList };
}
