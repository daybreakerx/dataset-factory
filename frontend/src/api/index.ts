/**
 * 后端 API 客户端 · 聚合门面：接口实现按域拆在同目录的 `<域>.ts` 里，这里把各域
 * 重新组装成单一的 `api` 对象，调用方的 `import { api } from ".../api"` 照常解析。
 *
 * 类型来源：`api-types.gen.ts` 由 `npm run gen:api` 从 backend/openapi.json 生成——
 * 后端改了字段、重新导出快照，这里的类型跟着变，字段对不上在 typecheck 当场报错，
 * 不再靠人眼对齐（这就是「API 契约」的前端侧）。
 */

import { batchesApi } from "./batches";
import { endpointsApi } from "./endpoints";
import { exportApi } from "./export";
import { filesystemApi } from "./filesystem";
import { labelApi } from "./label";
import { promptsApi } from "./prompts";
import { runsApi } from "./runs";
import { serviceApi } from "./service";
import { sessionsApi } from "./sessions";
import { skillsApi } from "./skills";
import { strategiesApi } from "./strategies";
import { tasksApi } from "./tasks";
import { workdirApi } from "./workdir";

export { ApiError, errorMessage } from "./client";
export type {
  ConfigResponse,
  ConfigUpdateRequest,
  EndpointConfigSummary,
  EndpointCreateRequest,
  EndpointRequestParams,
  EndpointTestRequest,
  EndpointTestResult,
  EndpointUpdateRequest,
} from "./endpoints";
export type { LabelRequest } from "./label";
export type {
  PromptCreated,
  PromptFull,
  PromptInfo,
  PromptRenameRequest,
  PromptSaveRequest,
} from "./prompts";
export type { ServiceLogs, ServiceStatus } from "./service";
export type { HistoryMessageView, SessionSnapshotResponse } from "./sessions";
export type {
  SkillFileContent,
  SkillFileInfo,
  SkillFilesResponse,
  SkillImportResponse,
  SkillInfo,
  SkillRenameRequest,
} from "./skills";
export type { TaskView } from "./tasks";

/** 后端接口的薄封装：一处集中管理路径与类型，界面代码只管调用。 */
export const api = {
  ...filesystemApi,
  ...workdirApi,
  ...batchesApi,
  ...runsApi,
  ...exportApi,
  ...strategiesApi,
  ...tasksApi,
  ...sessionsApi,
  ...labelApi,
  ...promptsApi,
  ...skillsApi,
  ...endpointsApi,
  ...serviceApi,
};
