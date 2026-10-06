import { RefreshCwIcon } from "lucide-react";
import type { ReactElement } from "react";
import { useEffect, useReducer, useState } from "react";
import { api, errorMessage } from "../../../api";
import type { components } from "../../../api-types.gen";
import { FormError } from "../../../components/form-error";
import { HScroll } from "../../../components/hs-scroll";
import { Button } from "../../../components/ui/button";
import { Tip } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";

/** 端点健康探测结果（components/marks.md：点的每个颜色都要有数据来源）。 */
type EndpointHealth = {
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
function reprobe(name: string): void {
  healthCache.delete(name);
  healthGen.set(name, (healthGen.get(name) ?? 0) + 1);
  notifyAll();
}

function useEndpointHealth(
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

const HEALTH_DOT: Record<EndpointHealth["status"], string> = {
  // 2026-09-21 定形：.dot--run 的呼吸是全站唯一持续动画——
  // 探测中改静态蓝点；「正在探测」的信息由文案承载，不靠动画。
  probing: "bg-info-dot",
  ok: "bg-ok-dot",
  bad: "bg-bad-dot",
  unknown: "bg-n-400",
};

/** base_url → 可读服务商名（V9）：`api.siliconflow.cn` → SiliconFlow；推不出回退配置名。 */
function readableProviderName(baseUrl: string, fallback: string): string {
  const KNOWN: Record<string, string> = {
    "api.siliconflow.cn": "SiliconFlow",
    "api.openai.com": "OpenAI",
    "dashscope.aliyuncs.com": "DashScope",
    "api.deepseek.com": "DeepSeek",
    "open.bigmodel.cn": "智谱",
  };
  try {
    const host = new URL(baseUrl).hostname;
    if (KNOWN[host] !== undefined) return KNOWN[host];
    const brand = host.replace(/^api\./, "").split(".")[0] ?? "";
    return brand === "" ? fallback : brand.charAt(0).toUpperCase() + brand.slice(1);
  } catch {
    return fallback;
  }
}

/** 模型名去服务商命名空间（V9）：`Qwen/Qwen3.5-4B` → `Qwen3.5-4B`。 */
function shortModelName(model: string): string {
  const index = model.indexOf("/");
  return index === -1 ? model : model.slice(index + 1);
}

/** 只读标签（规范实体＝base.css §9 .ro-chip）：--h-sm／--r-md／--muted 底／无描边／
 *  --t-sm 字色 --text-2；flex-none ＋ nowrap＝超宽时该滚的是外层链（hs 定式）、不把标签压瘪。
 *  端点枚带尾随重探钮时再叠 pr-1（§9 .ro-chip--act：右内距收到 --s-1，钮盒不顶圆角）。 */
const RO_CHIP =
  "inline-flex h-(--h-sm) max-w-full flex-none items-center gap-2 whitespace-nowrap rounded-lg bg-muted px-3 text-t-sm text-text-2";

export function BatchConfiguration({
  wid,
  batch,
  compact = false,
}: {
  wid: string;
  batch: string;
  compact?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<
    components["schemas"]["BatchSnapshotView"] | null
  >(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision explicitly retries the snapshot read.
  useEffect(() => {
    let current = true;
    setSnapshot(null);
    setError("");
    void api.getBatchSnapshot(wid, batch).then(
      (value) => {
        if (current) setSnapshot(value);
      },
      (reason: unknown) => {
        if (current) setError(errorMessage(reason));
      },
    );
    return () => {
      current = false;
    };
  }, [wid, batch, revision]);

  if (error)
    return (
      // 取数失败（稿 .lb-reqerr）：红字＋行内重读图标钮（2026-10-05 用户裁「重新读取
      // 也用图标」，形态同端点尾的重探钮＝既有档 icon-xs、Tip 补语义——改图标后文字不再上屏）。
      <div className="flex items-center gap-2 py-2">
        <FormError className="text-t-sm text-bad-ink">{error}</FormError>
        <Tip label="重新读取">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="重新读取"
            onClick={() => setRevision((value) => value + 1)}
          >
            <RefreshCwIcon />
          </Button>
        </Tip>
      </div>
    );
  if (!snapshot)
    return (
      <p role="status" className="py-2 text-t-sm text-text-4">
        正在读取策略配置
      </p>
    );
  if (compact)
    return (
      <section aria-label="策略配置" className="flex min-w-0 flex-1">
        {/* 链容器＝hs 定式（对齐批「请求链胶囊对齐」①）：胶囊 flex-none 不换行，超宽即横向
            溢出、由自绘拇指条接管（先例 ChatColumn 已选 Skill 条）——撤原 flex-wrap。轨道
            间距 --s-3（hs 默认 --s-2）：globals 的 .hs-scroll 是无层声明、压过层内工具类，
            覆盖须带 important（globals.css「无层声明」注）。 */}
        <HScroll className="flex-1" trackClassName="gap-3!">
          <EndpointChip endpoint={snapshot.endpoint} />
          {[
            { key: "prompt", value: snapshot.prompt.name },
            ...snapshot.skills.map((entry) => ({
              key: `skill/${entry.name}`,
              value: entry.name,
            })),
          ].map(({ key, value }) => (
            <Tip key={key} label={value}>
              <span className={RO_CHIP}>
                <span className="truncate">{value}</span>
              </span>
            </Tip>
          ))}
        </HScroll>
      </section>
    );
  return (
    <dl className="px-6 pb-3 text-t-sm">
      {Object.entries({
        端点配置: `${snapshot.endpoint.name} · ${snapshot.endpoint.model}`,
        基础提示词: snapshot.prompt.name,
        Skill: snapshot.skills.map((entry) => entry.name).join("、") || "无",
        创建时间: new Date(snapshot.built_at).toLocaleString(),
      }).map(([label, value]) => (
        <div key={label} className="flex gap-3 py-1">
          <dt className="w-[84px] shrink-0 text-text-4">{label}</dt>
          <dd className="min-w-0 break-all text-text-2">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 顶栏端点章（C1）：带健康状态点 + 重新探测入口；Tip 留全量信息（V9）。 */
function EndpointChip({
  endpoint,
}: {
  endpoint: components["schemas"]["SnapshotEndpointView"];
}): ReactElement {
  const health = useEndpointHealth(endpoint.name, endpoint);
  const label = `${readableProviderName(endpoint.base_url, endpoint.name)} · ${shortModelName(endpoint.model)}`;
  const fullTitle = `${endpoint.name} · ${endpoint.model} · ${health.message}`;
  const act = health.status === "bad" || health.status === "unknown";
  return (
    <Tip label={fullTitle}>
      <span className={cn(RO_CHIP, act && "pr-1")}>
        <span
          aria-hidden
          className={`size-1.5 shrink-0 rounded-full ${HEALTH_DOT[health.status]}`}
        />
        <span className="truncate">{label}</span>
        {act && (
          // 重探钮改既有档 icon-xs（对齐批④：22×22／图标 13）；补自己的 Tip（⑤）——
          // 原先裸 aria-label 时悬停弹的是外层端点胶囊的全量气泡。静止色 --text-3、
          // 悬停转 --text-1＝ghost 变体自带（⑥，先例 .pl-ic）。
          <Tip label="重新探测">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="重新探测"
              onClick={(event) => {
                event.stopPropagation();
                reprobe(endpoint.name);
              }}
            >
              <RefreshCwIcon />
            </Button>
          </Tip>
        )}
      </span>
    </Tip>
  );
}
