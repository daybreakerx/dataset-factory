/**
 * 后端 API 客户端的公共件：统一的 fetch 封装、超时常量与错误类型。
 * 各域文件只从这里引请求与错误件，不直接摸 fetch。
 */

/** 错误体的契约形状是 problem+json（type/title/status/detail，RFC 9457）——错误路径也在契约里，不再有盲区。 */

/** 把任意抛出的东西变成可展示的一句话（界面上不该出现 "[object Object]"）。 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 管理操作的请求超时：都该秒回（打标走流式 labelStream，自带增量反馈、不设硬超时）。 */
export const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * 端点探测的前端超时（B2，2026-09-21 审计定案）：必须**大于**后端探测的 8 秒——
 * 前端先掐的话，用户永远看不到后端那句可操作的解释，只会得到一句通用超时文案。
 */
export const PROBE_TIMEOUT_MS = 12_000;

/** 带上下文的 API 错误：界面上不止一句话，还能拿到「哪一层」与「请求 id」。 */
export class ApiError extends Error {
  /** HTTP 状态码；请求根本没到服务器（网络断 / 超时）时为 null。 */
  readonly status: number | null;
  /** 错误类别：timeout（前端主动放弃）/ network（连不上后端）/ http（后端返回了错误）。 */
  readonly kind: "timeout" | "network" | "http";
  /** 后端中间件写在 X-Request-ID 响应头里的请求 id；拿它去后端日志里串一整条链。 */
  readonly requestId: string | null;
  /** 字段级错误标记：后端指认 detail 属于哪个输入字段（如 name）；操作级 / 环境类为 null。 */
  readonly field: string | null;
  /** problem+json 的 type slug（如 run-journal-corrupted）；非 problem 体为 null。 */
  readonly problemType: string | null;
  /** problem+json 的扩展字段 `run`：损坏的那份运行目录名＝清理端点的取值；没有则 null。 */
  readonly run: string | null;

  constructor(
    kind: ApiError["kind"],
    message: string,
    status: number | null,
    requestId: string | null,
    field: string | null = null,
    problemType: string | null = null,
    run: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.kind = kind;
    this.requestId = requestId;
    this.field = field;
    this.problemType = problemType;
    this.run = run;
  }
}

/**
 * 这句错误是不是「运行流水损坏、且后端叫得出是哪一份」。
 *
 * 就地出口的可用性必须由后端带出的 `run` 决定（ADR 2026-10-09）：四处出错面同一把尺，
 * 不允许出现「同一句红字有的面能点、有的面不能点」。
 */
export function corruptedRunOf(error: unknown): string | null {
  return error instanceof ApiError &&
    error.problemType === "run-journal-corrupted" &&
    error.run
    ? error.run
    : null;
}

/** 从 problem+json 体里取 type 与扩展字段 run（非 problem 体 / 类型不对都回 null）。 */
function extractProblem(data: unknown): {
  problemType: string | null;
  run: string | null;
} {
  if (data === null || typeof data !== "object") {
    return { problemType: null, run: null };
  }
  const body = data as { type?: unknown; run?: unknown };
  return {
    problemType: typeof body.type === "string" ? body.type : null,
    run: typeof body.run === "string" ? body.run : null,
  };
}

/**
 * 从后端错误响应里取出可读消息。
 *
 * 后端错误体统一为 problem+json（detail 是一句话）；FastAPI 422 校验失败是约定
 * 保留项 → `{"detail": [{loc, msg}, ...]}`。这里把两种都摊平成文本，一次把校验错误报全。
 */
export function extractDetail(data: unknown, status: number): string {
  if (data !== null && typeof data === "object" && "detail" in data) {
    const detail: unknown = (data as { detail: unknown }).detail;
    if (typeof detail === "string") {
      return detail;
    }
    if (Array.isArray(detail)) {
      return detail
        .map((item) => {
          if (item !== null && typeof item === "object") {
            const entry = item as { loc?: unknown; msg?: unknown };
            const where = Array.isArray(entry.loc) ? entry.loc.join(".") : "";
            return where === "" ? String(entry.msg) : `${where}: ${String(entry.msg)}`;
          }
          return String(item);
        })
        .join("；");
    }
  }
  return `HTTP ${status}`;
}

/**
 * 从后端错误响应里取出字段级标记（problem+json 的 field 扩展字段）。
 *
 * 后端指认「这句错误属于哪个输入字段」（如 name）时返回该字段名；操作级错误、
 * 无该键或类型不对都返回 null——调用方据它决定要不要把错误精确挂到输入框上。
 */
export function extractErrorField(data: unknown): string | null {
  if (data !== null && typeof data === "object" && "field" in data) {
    const field: unknown = (data as { field: unknown }).field;
    if (typeof field === "string") {
      return field;
    }
  }
  return null;
}

/**
 * 统一请求：自动带 JSON 头、204 视为无内容、错误抛成带上下文的 ApiError。
 *
 * 三层失败各有自己的说法（这是「错误按层展示」的地基）：
 * - 连不上后端（fetch 直接抛 TypeError）→ network，提示查 dsf serve 是否在跑；
 * - 超时（AbortController 主动放弃）→ timeout，说明等了多久、后端可能仍在处理；
 * - 后端返回错误 → http，透传后端的一句话 + 请求 id。
 */
export async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  responseType: "json" | "text" = "json",
): Promise<T> {
  // 超时用 AbortController 实现：到点放弃等待，而不是无限期挂着。
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // FormData（multipart 上传）由浏览器自动带边界头，不能手动设 Content-Type。
  const isFormData = body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers:
        body === undefined || isFormData ? {} : { "Content-Type": "application/json" },
      body:
        body === undefined
          ? undefined
          : isFormData
            ? (body as FormData)
            : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    // fetch 对「主动 abort」和「网络错误」都抛同一个异常族，用 abort 标志区分。
    if (controller.signal.aborted) {
      const seconds = Math.round(timeoutMs / 1000);
      throw new ApiError(
        "timeout",
        `等待 ${seconds} 秒没有响应，已主动放弃（后端可能仍在处理，稍后可在会话列表里查看是否完成）`,
        null,
        null,
      );
    }
    throw new ApiError(
      "network",
      "无法连接后端服务——请确认 dsf serve 已启动、端口没有填错",
      null,
      null,
    );
  } finally {
    clearTimeout(timer);
  }
  // 请求 id 无论成败都从响应头取：错误时展示给用户，成功时也留在日志可查。
  const requestId = response.headers.get("X-Request-ID");
  if (response.ok && responseType === "text") {
    return (await response.text()) as T;
  }
  if (response.status === 204) {
    // 无内容响应：调用方声明的是 void，这里的断言只是让类型收口。
    return undefined as T;
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const suffix =
      requestId === null ? "" : `（请求 id: ${requestId}，可拿它对后端日志）`;
    const problem = extractProblem(data);
    throw new ApiError(
      "http",
      `${extractDetail(data, response.status)}${suffix}`,
      response.status,
      requestId,
      extractErrorField(data),
      problem.problemType,
      problem.run,
    );
  }
  return data as T;
}
