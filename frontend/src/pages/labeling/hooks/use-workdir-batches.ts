import type { Dispatch, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../api";
import { readStoredJson, writeStoredJson } from "../../../lib/ui-storage";
import type { BatchSelection, WorkdirBatches } from "../batching/BatchSelector";

/** localStorage 里恢复的 selection 要过形状检查：脏 JSON 不许流进取数链路。 */
function isBatchSelection(value: unknown): value is BatchSelection {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as BatchSelection).workdirId === "string" &&
    typeof (value as BatchSelection).batchId === "string"
  );
}

export async function loadWorkdirBatches(): Promise<WorkdirBatches[]> {
  const directories = await api.listWorkdirs();
  return Promise.all(
    directories.map(async (entry) => {
      try {
        return {
          id: entry.id,
          title: entry.title,
          path: entry.path,
          batches: await api.listBatches(entry.id),
        };
      } catch (reason) {
        return {
          id: entry.id,
          title: entry.title,
          path: entry.path,
          batches: [],
          error: errorMessage(reason),
        };
      }
    }),
  );
}

/** 目录与批次切换以成对身份取数，过期请求不能覆盖新选择。 */
export function useWorkdirBatches({
  setError,
  setLoading,
}: {
  setError: Dispatch<SetStateAction<string>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
}): {
  workdirs: WorkdirBatches[];
  setWorkdirs: Dispatch<SetStateAction<WorkdirBatches[]>>;
  selection: BatchSelection | null;
  setSelection: Dispatch<SetStateAction<BatchSelection | null>>;
  setDirectoriesRevision: Dispatch<SetStateAction<number>>;
} {
  const [workdirs, setWorkdirs] = useState<WorkdirBatches[]>([]);
  // selection 两阶段（2026-09-23 排查：删数据根后记忆 wid 必然先撞一轮 404 并闪
  // 「不在注册表中」横幅）：记忆值只作候选——启动先拉目录列表，对上才提交为正式
  // selection，对不上（删数据根 / 外部删目录 / 批次被删）静默回退默认。items /
  // latestRun / RunControl / 快照等取数方全部以 selection 存在为渲染前提，提交前
  // 天然零请求。左列筛选词 / 折叠 / 组内展开仍走 usePersistedState（无关取数链路）。
  const rememberedSelectionRef = useRef<BatchSelection | null>(
    readStoredJson("dsf-labeling-selection", isBatchSelection),
  );
  const [selection, setSelection] = useState<BatchSelection | null>(null);
  const [directoriesRevision, setDirectoriesRevision] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: directoriesRevision refreshes the registry after directory settings mutations.
  useEffect(() => {
    let current = true;
    void loadWorkdirBatches()
      .then((loaded) => {
        if (!current) return;
        setWorkdirs(loaded);
        // 记忆候选只在启动首轮生效一次（此后 directoriesRevision 刷新沿用既有校验
        // 回退，previous 即在选批次）。在 updater 外消费：updater 必须保持纯函数
        // （StrictMode / 并发渲染会重复调用 updater，ref 突变在内会被吃掉一次）。
        const remembered = rememberedSelectionRef.current;
        rememberedSelectionRef.current = null;
        const directory = loaded.find((entry) =>
          entry.batches.some((batch) => batch.active),
        );
        const batch = directory?.batches.find((entry) => entry.active);
        setSelection((previous) => {
          const candidate = previous ?? remembered;
          if (
            candidate &&
            loaded.some(
              (entry) =>
                entry.id === candidate.workdirId &&
                entry.batches.some(
                  (item) => item.id === candidate.batchId && item.active,
                ),
            )
          )
            return candidate;
          return directory && batch
            ? { workdirId: directory.id, batchId: batch.id }
            : null;
        });
      })
      .catch((reason: unknown) => {
        if (current) setError(errorMessage(reason));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [directoriesRevision]);

  // selection 落盘（记忆候选的写入侧）：提交 / 回退 / 换批次都如实记，下次启动按它对账。
  useEffect(() => {
    writeStoredJson("dsf-labeling-selection", selection);
  }, [selection]);

  return {
    workdirs,
    setWorkdirs,
    selection,
    setSelection,
    setDirectoriesRevision,
  };
}
