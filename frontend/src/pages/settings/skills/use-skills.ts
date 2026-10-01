/**
 * 技能面板的数据 hook：收拢查询类调用（技能列表及其刷新），供面板各区块共享。
 * 命令类调用（启停 / 导入 / 删除 / 存文件 / 改名）留在面板调用点，不在这里包装。
 */
import { useCallback, useState } from "react";
import type { SkillInfo } from "../../../api";
import { api } from "../../../api";

/** 查询失败的处理回调（连接类失败走浮层、业务错误就地展示的分流由调用方定义）。 */
type FailFeedback = (err: unknown) => void;

/**
 * 技能列表查询：暴露当前列表与手动刷新（导入 / 删除 / 保存等命令后由面板刷新列表）。
 *
 * @param failFeedback - 查询失败时的反馈回调（与面板各命令共用同一分流）。
 * @returns 列表状态与刷新；刷新返回本次拉到的列表（失败返回空数组）。
 */
export function useSkills(failFeedback: FailFeedback): {
  skills: SkillInfo[];
  reload: () => Promise<SkillInfo[]>;
} {
  const [skills, setSkills] = useState<SkillInfo[]>([]);

  const reload = useCallback(async (): Promise<SkillInfo[]> => {
    try {
      const list = await api.listSkills();
      setSkills(list);
      return list;
    } catch (err) {
      failFeedback(err);
      return [];
    }
  }, [failFeedback]);

  return { skills, reload };
}
