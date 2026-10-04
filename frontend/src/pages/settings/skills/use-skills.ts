/**
 * 技能面板的数据 hook：收拢查询类调用（技能列表及其刷新），供面板各区块共享。
 * 命令类调用（启停 / 导入 / 删除 / 存文件 / 改名）留在面板调用点，不在这里包装。
 */
import { useCallback, useState } from "react";
import type { SkillInfo } from "../../../api";
import { api } from "../../../api";
import { reportError } from "../../../lib/feedback";

/**
 * 技能列表查询：暴露当前列表与手动刷新（导入 / 删除 / 保存等命令后由面板刷新列表）。
 * 失败分流＝只接非连接类置列表失败态（连接类由 reportError 改走浮层、后端原文不进界面，
 * 见 components/list.md「列表列的三态」）；取数中单独表达，不拿空态顶。
 *
 * @returns 列表状态（含取数中／取数失败标志）与刷新；刷新返回本次拉到的列表（失败返回空数组）。
 */
export function useSkills(): {
  skills: SkillInfo[];
  loading: boolean;
  loadError: boolean;
  reload: () => Promise<SkillInfo[]>;
} {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const reload = useCallback(async (): Promise<SkillInfo[]> => {
    setLoading(true);
    try {
      const list = await api.listSkills();
      setSkills(list);
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

  return { skills, loading, loadError, reload };
}
