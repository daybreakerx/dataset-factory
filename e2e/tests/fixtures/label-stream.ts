import type { APIRequestContext, Page } from "@playwright/test";

// 「流式中」屏的专用底座：真后端 + 假模型闸门（e2e/serving.py build_fake_llm_app）。
//
// 为什么这一屏不走纯桩：SSE 请求经 page.route 一次性 fulfill 时，前端 fetch 循环在
// 一轮微任务里收完全部帧、直接落到完成态——「响应中」面板没有可见窗口。要钉住流式中
// 的渲染形态，只能让请求穿过桩打到真后端，由 serving.py 的闸门端点把**带素材**的模型
// 调用挂住（gated-e2e-model），界面停在「响应中」，采集后再放行。
//
// 链路（全真，只有模型是假的）：界面发送 → POST /api/label/stream（桩放行）→ 真后端
// → 数据根里的端点配置（base_url 指向本服务 /fake-llm/v1）→ 假模型闸门 → 挂起。
//
// 一致性关键：前端发送的 payload 带 prompt_id / skill_ids / strategy_id（来自界面上的
// 桩数据状态），后端按这些 id 真查数据根——所以先在真后端造数、拿到**真分配的 id**，
// 再用同 id 构造前端桩表，两边就指同一批实体。

const PORT = 8765;

/** 1×1 透明 PNG：附件上传的固定素材（与 api-stubs 的桩件同源）。 */
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";

/** 闸门端点挂在被测服务的 /fake-llm mount 下。 */
function gatedUrl(path: string): string {
  return `http://127.0.0.1:${PORT}/fake-llm${path}`;
}

/** serving.py 预写的固定 ID 提示词（见 serving.py main 的预写段——id 合 PROMPT_ID_RE）。 */
const FIXED_PROMPT_ID = "pbaseline01";

export interface GatedIds {
  endpointId: string;
  promptId: string;
  strategyId: string;
}

/**
 * 在真后端数据根里造一套「gated 策略」：端点配置（模型 = gated-e2e-model）+ 提示词 +
 * 策略。id 由后端分配，调用方把它们回填进前端桩表（gatedOverrides）。
 *
 * 幂等：按名查重，已存在则跳过建（E2E 造数跨轮残留的既有口径）。
 */
export async function seedGatedStrategy(request: APIRequestContext): Promise<GatedIds> {
  // 端点配置：base_url 指向本服务自己的假模型 mount，模型名命中闸门。
  const endpoints = (await (await request.get("/api/endpoints")).json()) as Array<{
    id: string;
    name: string;
  }>;
  let endpointId = endpoints.find((entry) => entry.name === "gated-probe")?.id;
  if (endpointId === undefined) {
    const created = (await (
      await request.post("/api/endpoints", {
        data: {
          name: "gated-probe",
          base_url: `http://127.0.0.1:${PORT}/fake-llm/v1`,
          model: "gated-e2e-model",
          api_key: "sk-probe-noop", // pragma: allowlist secret — 取证造数用假密钥
          api_format: "openai-chat-completions",
        },
      })
    ).json()) as { id: string };
    endpointId = created.id;
  }
  // 显式激活：对话链路（routes_labeling.build_engine → read_config）按「当前使用」配置
  // 解析模型端点，不走策略绑定的端点——不激活，对话仍打在 serving.py 预写的 default
  // （fake-e2e-model，不进闸门）上，闸门永远等不到调用。
  await request.post(`/api/endpoints/${encodeURIComponent(endpointId)}/activate`);

  // 提示词：用 serving.py 预写的固定 ID 条目，不再随机创建（随机 id 会让请求清单快照漂）。

  // 策略（引用固定 id 提示词与 gated 端点；skill_ids 留空——真后端没有技能可引）。
  const strategies = (await (await request.get("/api/strategies")).json()) as Array<{
    id: string;
    name: string;
  }>;
  let strategyId = strategies.find((entry) => entry.name === "闸门探针策略")?.id;
  if (strategyId === undefined) {
    const created = (await (
      await request.post("/api/strategies", {
        data: {
          name: "闸门探针策略",
          description: "流式中基线屏专用",
          prompt_id: FIXED_PROMPT_ID,
          skill_ids: [],
          endpoint_id: endpointId,
        },
      })
    ).json()) as { id: string };
    strategyId = created.id;
  }

  return { endpointId, promptId: FIXED_PROMPT_ID, strategyId };
}

/**
 * 用真 id 构造前端桩表覆盖：界面上展示与选中的都是真后端里存在的实体，
 * 发送的 prompt_id / strategy_id 才能被真后端解析。会话历史桩为空（发送走界面）。
 */
export function gatedOverrides(ids: GatedIds): Record<string, unknown> {
  return {
    "GET /api/prompts": [
      { id: ids.promptId, name: "详细描述", description: "通用详细描述提示词" },
    ],
    [`GET /api/prompts/${ids.promptId}`]: {
      id: ids.promptId,
      name: "详细描述",
      description: "通用详细描述提示词",
      body: "请用中文详细描述这张图的主体、姿态、背景与光线。",
    },
    "GET /api/skills": [],
    "GET /api/sessions/latest": null,
    "GET /api/strategies": [
      {
        id: ids.strategyId,
        name: "基线策略",
        description: "视觉基线用策略",
        enabled: true,
        prompt_id: ids.promptId,
        skill_ids: [],
        endpoint_id: ids.endpointId,
        updated_at: "2026-01-01T00:00:00+00:00",
      },
    ],
  };
}

/** 桩放行谓词：只放行打标流式请求，其余照旧桩。 */
export function streamPassthrough(method: string, pathname: string): boolean {
  return method === "POST" && pathname === "/api/label/stream";
}

/** 重置闸门（计数与等待位），串行屏之间互不串味。 */
export async function gatedReset(request: APIRequestContext): Promise<void> {
  await request.post(gatedUrl("/__test__/gated-reset"));
}

/**
 * 轮询闸门握手直到模型调用挂住（或超时）。
 *
 * 返回自 reset 起进闸门的调用数：界面发送前后的差值应 ≥1。探测调用不带素材、
 * 不进闸门（serving.py 只让带素材的 gated 调用挂起），但保留计数返回供诊断。
 */
export async function waitGateEntered(
  request: APIRequestContext,
  timeoutMs = 15_000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await request.post(gatedUrl("/__test__/gated-entered"));
    const state = (await response.json()) as { entered: boolean; count: number };
    if (state.entered) {
      return state.count;
    }
    if (Date.now() > deadline) {
      throw new Error(`闸门握手超时（${String(timeoutMs)}ms）——模型调用没挂住`);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

/** 放行闸门：挂住的模型调用返回固定回复，前端收完流。 */
export async function gatedRelease(request: APIRequestContext): Promise<void> {
  await request.post(gatedUrl("/__test__/gated-release"));
}

/**
 * 起一屏（流式中版）：boot 同款流程，但路由桩带放行谓词。
 * 独立于 fixtures/baseline-probe.ts 的 boot——避免给所有屏强加 passthrough 参数。
 */
export async function bootGated(
  page: Page,
  sink: string[],
  overrides: Record<string, unknown>,
): Promise<void> {
  const { stubApi } = (await import("./api-stubs")) as typeof import("./api-stubs");
  await page.setViewportSize({ width: 1440, height: 900 });
  await stubApi(page, sink, overrides, streamPassthrough);
  await page.goto("/");
  await page.waitForFunction(() => document.fonts.status === "loaded");
}

export { PNG_1PX };
