/** 端点连通性探测（打标页与策略页共用）：会话级缓存＋TTL＋重探广播。
 *  提取自 BatchConfiguration（2026-09-25 用户裁
 *  「需要补全实现」＋「和打标页保持一致」——两页同语义同探测，不另设计）。 */
import { useEffect, useReducer } from "react";
import { api, errorMessage } from "../api";

/** 端点健康探测结果（components/marks.md：点的每个颜色都要有数据来源）。 */
export type EndpointHealth = {
  status: "probing" | "ok" | "bad" | "unknown";
  message: string;
};

/** 缓存条目带时间戳：探测结果会过期，不许一路灰着（B2，2026-09-21 审计）。 */
type CachedHealth = EndpointHealth & { at: number };

/** 会话级探测缓存：按端点名记一次结果 + 时刻，切回视图不重复探测。 */
const healthCache = new Map<string, CachedHealth>();
const healthGen = new Map<string, number>();
const healthListeners = new Set<() => void>();

/** 探测结果的有效期：过期后视图挂载即自动重探（60 秒，B2 定案）。 */
const HEALTH_TTL_MS = 60_000;

function notifyAll(): void {
  for (const notify of healthListeners) notify();
}

function setHealth(name: string, health: EndpointHealth): void {
  healthCache.set(name, { ...health, at: Date.now() });
  notifyAll();
}

/** 「重新探测」入口（B2）：清缓存 + 唤醒全部订阅者重跑探测。 */
export function reprobe(name: string): void {
  healthCache.delete(name);
  healthGen.set(name, (healthGen.get(name) ?? 0) + 1);
  notifyAll();
}

export function useEndpointHealth(
  name: string,
  target:
    | {
        id?: string | null;
        base_url: string;
        model: string;
        api_format: string;
      }
    | undefined,
): EndpointHealth {
  const [, force] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    healthListeners.add(force);
    return () => {
      healthListeners.delete(force);
    };
  }, []);
  const baseUrl = target?.base_url;
  const model = target?.model;
  const apiFormat = target?.api_format;
  const generation = healthGen.get(name) ?? 0;
  const cached = healthCache.get(name);
  // biome-ignore lint/correctness/useExhaustiveDependencies: cached 的读取是有意的快照判定——重探由 reprobe 的 generation 变化与 TTL 过期驱动，不随每次缓存写入重跑。
  useEffect(() => {
    if (!baseUrl || !model) return;
    // 有未过期缓存就不重探；过期（或刚被 reprobe 清掉）则自动重跑。
    if (cached !== undefined && Date.now() - cached.at < HEALTH_TTL_MS) return;
    setHealth(name, { status: "probing", message: "正在探测端点连通性…" });
    void api
      .testEndpoint({
        base_url: baseUrl,
        model,
        api_format: apiFormat ?? "",
        id: target?.id ?? null,
      })
      .then((result) =>
        setHealth(
          name,
          result.ok
            ? {
                status: "ok",
                message: `端点连通 · 首字 ${(result.latency_ms / 1000).toFixed(2)} 秒`,
              }
            : { status: "bad", message: result.message },
        ),
      )
      .catch((reason: unknown) =>
        setHealth(name, {
          // unknown ≠ bad：bad 是「后端判定端点不通」，unknown 是「前端自己没问到」
          // （超时 / 断网）——灰点说真话，不再让用户误会成端点坏了。
          status: "unknown",
          message: `探测请求未完成（${errorMessage(reason)}）——这是探测本身的问题，不代表端点不通；可点右侧按钮重试。`,
        }),
      );
    // generation 变化（reprobe）必须重跑；cached 变化由 notify 驱动重渲染后判定。
  }, [name, baseUrl, model, apiFormat, generation]);
  return healthCache.get(name) ?? { status: "probing", message: "正在探测端点连通性…" };
}

/** 状态点四态（components/marks.md「一屏至多一个呼吸」）：打标页与跑批呼吸点同屏，
 *  探测中保持**静态**蓝点、「正在探测」由文案承载（2026-09-21 定形）。 */
export const HEALTH_DOT: Record<EndpointHealth["status"], string> = {
  probing: "bg-info-dot",
  ok: "bg-ok-dot",
  bad: "bg-bad-dot",
  unknown: "bg-n-400",
};

/** 策略页 chip 的点色（稿 端点切换弹层「触发件 · 点色四态」）：该页无跑批呼吸点同屏
 *  竞争，探测中走**呼吸蓝**（用户裁「呼吸代表探测中」）；呼吸节奏归一稿点名的
 *  dot--run（1.6s／谷值 0.35，globals.css .animate-dot-run——2026-10-06 审计呈报后随
 *  收口归一，不再借用 service-dot 的 animate-pulse）。 */
export const HEALTH_DOT_BREATHING: Record<EndpointHealth["status"], string> = {
  ...HEALTH_DOT,
  probing: "bg-info-dot animate-dot-run",
};
