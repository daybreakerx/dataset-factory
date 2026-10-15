import type { Dispatch, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../api";
import { reportError } from "../../../lib/feedback";
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
  setLoading,
}: {
  setLoading: Dispatch<SetStateAction<boolean>>;
}): {
  workdirs: WorkdirBatches[];
  setWorkdirs: Dispatch<SetStateAction<WorkdirBatches[]>>;
  selection: BatchSelection | null;
  setSelection: Dispatch<SetStateAction<BatchSelection | null>>;
  setDirectoriesRevision: Dispatch<SetStateAction<number>>;
  /** 弹层重拉的飞行态（打开重拉期间为 true，供弹层换「正在读取…」行）。 */
  flight: boolean;
  /** 目录清单取数失败（只接非连接类；连接类已转浮层），供弹层换失败行。 */
  loadError: string | null;
} {
  const [workdirs, setWorkdirs] = useState<WorkdirBatches[]>([]);
  // 弹层自己的飞行 / 失败标志（族三态行口径：打开重拉期间
  // 整层换「正在读取…」、失败换「工作目录读取失败」且只接非连接类——连接类由 reportError
  // 转浮层提示、不占层内）。失败不馈页面横幅（ADR「workdir 取数失败不进页面横幅」，挂账
  // 第 1 条 2026-10-06 裁 B：弹层行／Toast 已是贴身的单一通路，横幅再收一份＝重复呈现，
  // 且会被打开着的弹层压在下面）；页面 loading 仍由本 hook 收尾——弹层重拉不让整页闪骨架。
  const [flight, setFlight] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
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
    setFlight(true);
    setLoadError(null);
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
        if (!current) return;
        // 单一通路（ADR「workdir 取数失败不进页面横幅」）：连接类 reportError 转 Toast、
        // 业务类进弹层失败行；横幅不收本链路的失败（挂账第 1 条裁决，2026-10-06）。
        if (reportError(reason) !== null) setLoadError("工作目录读取失败");
      })
      .finally(() => {
        if (current) {
          setLoading(false);
          setFlight(false);
        }
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
    flight,
    loadError,
  };
}
