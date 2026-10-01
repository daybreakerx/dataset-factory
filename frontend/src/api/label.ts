/**
 * 打标域：流式打标的 SSE 客户端（后端 routes_labeling 的打标半边）。
 */

import type { components } from "../api-types.gen";

import { ApiError, extractDetail } from "./client";

export type LabelRequest = components["schemas"]["LabelRequest"];

export const labelApi = {
  /**
   * 流式打标（SSE）：逐段回调思考 / 正文增量，done 回调带终稿与会话 id。
   *
   * POST + fetch 流式读取（EventSource 不支持 POST）；HTTP 层错误（预备段 4xx/5xx）
   * 直接抛 ApiError，流中的模型错误走 onError 回调（SSE 已开始、状态码改不了）。
   * `signal` 用于「停止生成」（N1，2026-09-21 审计）：用户主动中止，ApiError 的
   * message 是「已停止生成」，调用方按用户动作处理、不当失败展示。
   */
  labelStream: async (
    payload: LabelRequest,
    handlers: {
      onStart: (sessionId: string) => void;
      onDelta: (kind: "reasoning" | "content", text: string) => void;
      onDone: (sessionId: string, caption: string) => void;
      onError: (message: string) => void;
    },
    signal?: AbortSignal,
  ): Promise<void> => {
    let response: Response;
    try {
      response = await fetch("/api/label/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        ...(signal ? { signal } : {}),
      });
    } catch {
      if (signal?.aborted) {
        throw new ApiError("timeout", "已停止生成。", null, null);
      }
      throw new ApiError(
        "network",
        "无法连接后端服务——请确认 dsf serve 已启动、端口没有填错",
        null,
        null,
      );
    }
    if (!response.ok || response.body === null) {
      const data: unknown = await response.json().catch(() => null);
      throw new ApiError(
        "http",
        extractDetail(data, response.status),
        response.status,
        response.headers.get("X-Request-ID"),
      );
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      // 读流中途断掉 = 服务在生成途中退了（外部脚本杀进程最常见）。归入连接类失败，让界面
      // 按「连不上后端」统一提示，而不是把 `Failed to fetch` 这种原话丢给用户。
      // 用户主动停止（signal 已 abort）按「已停止生成」说，不当失败。
      const chunk = await reader.read().catch((): never => {
        if (signal?.aborted) {
          throw new ApiError("timeout", "已停止生成。", null, null);
        }
        throw new ApiError(
          "network",
          "与后端的连接中断，本轮没有完成——请确认服务在运行后重发",
          null,
          null,
        );
      });
      const { done, value } = chunk;
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const lines = frame.split("\n");
        const eventLine = lines.find((line) => line.startsWith("event: "));
        const dataLine = lines.find((line) => line.startsWith("data: "));
        if (eventLine === undefined || dataLine === undefined) {
          continue;
        }
        const event = eventLine.slice(7);
        // SSE data 字段理论上恒在；缺字段时给空串兜底（noUncheckedIndexedAccess 下不裸索引）。
        let data: Record<string, string | undefined>;
        try {
          data = JSON.parse(dataLine.slice(6)) as Record<string, string | undefined>;
        } catch {
          // 帧解析失败是「服务端发了不认识的东西」，与网络断开同类：给一句能读懂的
          // 话再中止本次读取，别把 SyntaxError 的原始报文丢给用户看。
          throw new ApiError("http", "收到的响应帧无法解析——请重发本轮。", null, null);
        }
        const sessionId = data.session_id ?? "";
        if (event === "start") {
          handlers.onStart(sessionId);
        } else if (event === "delta") {
          handlers.onDelta(
            data.kind === "reasoning" ? "reasoning" : "content",
            data.text ?? "",
          );
        } else if (event === "done") {
          handlers.onDone(sessionId, data.caption ?? "");
        } else if (event === "error") {
          handlers.onError(data.message ?? "生成中断：未知错误");
        }
      }
    }
  },
};
