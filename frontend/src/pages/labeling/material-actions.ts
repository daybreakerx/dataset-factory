/**
 * 素材处置的「直接执行」动作（2026-10-10 用户裁：所有可以从原处重新导入的，点击后直接
 * 执行；从别处导入唤起「目录选择弹窗」选定后同样直接执行——都不经导入弹窗、不另配确认弹窗）。
 *
 * 三个动作共用「受理 → 轮询到终态」这一副骨架（与导入弹窗同一取数口径：都问
 * `GET /api/tasks/{id}`）。调用方只在成功后重取清单、失败时把后端真话摆到该摆的位置。
 * 左列条目行与打包被排除清单共用这一份，免得两处各长一套轮询路径。
 */

import { api } from "../../api";

/** 轮询到任务终态：成功即返回，失败与取消都抛后端真话。 */
async function waitTask(taskId: string): Promise<void> {
  for (;;) {
    const view = await api.getTask(taskId);
    if (view.status === "succeeded") return;
    if (view.status === "failed") throw new Error(view.error ?? "任务失败，请重试。");
    if (view.status === "cancelled") throw new Error("任务已取消。");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** 未导入行「导入」：就地补登记这一份文件（工作目录里已有，只是没进登记册）。 */
export async function registerInPlace(wid: string, name: string): Promise<void> {
  const accepted = await api.importMaterials(wid, { names: [name] });
  await waitTask(accepted.task_id);
}

/** 缺失行「重新导入」：从登记在册的来源目录取回这一份（来源还在才可点）。 */
export async function reimportFromSource(wid: string, name: string): Promise<void> {
  const accepted = await api.reimportMaterials(wid, [name]);
  await waitTask(accepted.task_id);
}

/** 缺失行「重新指定」：从选定目录下把这一份复制进工作目录（新来源＝用户挑的那份文件）。 */
export async function importFromDirectory(
  wid: string,
  source: string,
  name: string,
): Promise<void> {
  const accepted = await api.importMaterials(wid, { source, names: [name] });
  await waitTask(accepted.task_id);
}

/** 界面用的「未导入」文案：后端机制常量仍叫「未登记」（2026-10-10 裁只动呈现层）。 */
export function exclusionLabel(reason: string | null | undefined): string {
  return reason === "未登记" ? "未导入" : (reason ?? "");
}
