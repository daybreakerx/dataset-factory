import { useEffect, useState } from "react";
import { ApiError, api, errorMessage, type TaskView } from "../../../api";
import type { components } from "../../../api-types.gen";

type Plan = components["schemas"]["ExportPlanView"];

/**
 * ExportPanel 的查询域收拢：导出计划（exportPlan，随顺序重命名开关与
 * revision/refreshKey 重取）＋导出任务观测（getTask 轮询，成功校验下载地址）。
 * 换批次时查询域在此复位并经 onIdentityReset 联动组件侧命令域的随行复位
 * （先于计划重取——顺序开关要回到默认 true，次序同拆分前）；排除／发车／
 * 取消是命令类，留组件调用点，经这里暴露的状态与 setter 协同。
 */
export function useExportFlow(
  wid: string,
  batch: string,
  refreshKey: unknown,
  onIdentityReset: () => void,
) {
  const [sequential, setSequential] = useState(true);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [planError, setPlanError] = useState("");
  const [task, setTask] = useState<TaskView | null>(null);
  const [pollFailed, setPollFailed] = useState(false);
  const [pollRevision, setPollRevision] = useState(0);
  const [error, setError] = useState("");
  const [download, setDownload] = useState<{ url: string; path: string } | null>(null);
  const taskId = task?.id;
  const taskStatus = task?.status;
  // biome-ignore lint/correctness/useExhaustiveDependencies: identity changes reset task ownership and invalidate pending responses.
  useEffect(() => {
    setPlan(null);
    setSequential(true);
    setTask(null);
    setDownload(null);
    setError("");
    setPlanError("");
    setPollFailed(false);
    onIdentityReset();
  }, [wid, batch, onIdentityReset]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: completed full synchronization and explicit refresh invalidate the export plan.
  useEffect(() => {
    let current = true;
    setLoading(true);
    setPlan(null);
    setPlanError("");
    api
      .exportPlan(wid, batch, sequential)
      .then((value) => {
        if (current) setPlan(value);
      })
      .catch((reason) => {
        if (current) setPlanError(errorMessage(reason));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [wid, batch, sequential, refreshKey, revision]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: requery observes the accepted task without submitting another export.
  useEffect(() => {
    if (!taskId || taskStatus !== "running") return;
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const id = taskId;
    setPollFailed(false);
    async function poll() {
      try {
        const view = await api.getTask(id);
        if (!current) return;
        if (view.id !== id) throw new Error("任务响应与当前导出不一致");
        if (view.status === "running") timer = setTimeout(() => void poll(), 2000);
        else if (view.status === "succeeded") {
          const result = view.result;
          if (
            !result ||
            typeof result !== "object" ||
            !("download_url" in result) ||
            typeof result.download_url !== "string" ||
            !("path" in result) ||
            typeof result.path !== "string"
          )
            throw new Error("导出结果格式无效");
          const prefix = `/api/workdirs/${encodeURIComponent(wid)}/export/files/`;
          if (
            !result.download_url.startsWith(prefix) ||
            !/^s[1-9][0-9]*-[0-9a-f]{24}\.zip$/.test(
              result.download_url.slice(prefix.length),
            )
          )
            throw new Error("导出下载地址无效");
          setDownload({ url: result.download_url, path: result.path });
          setRevision((value) => value + 1);
        } else
          setError(
            view.error || (view.status === "cancelled" ? "导出已取消" : "导出失败"),
          );
        setTask(view);
      } catch (reason) {
        if (current) {
          if (reason instanceof ApiError && reason.status === 404) {
            setTask(null);
            setPollFailed(false);
            setError("导出任务已丢失，请重新查询导出计划后重试");
            return;
          }
          setError(errorMessage(reason));
          setPollFailed(true);
        }
      }
    }
    void poll();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [taskId, taskStatus, wid, pollRevision]);

  return {
    plan,
    loading,
    planError,
    sequential,
    setSequential,
    revision,
    setRevision,
    task,
    setTask,
    download,
    setDownload,
    pollFailed,
    setPollFailed,
    pollRevision,
    setPollRevision,
    error,
    setError,
  };
}
