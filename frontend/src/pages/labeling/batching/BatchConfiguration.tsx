import { RefreshCwIcon } from "lucide-react";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { api } from "../../../api";
import type { components } from "../../../api-types.gen";
import { FormError } from "../../../components/form-error";
import { HScroll } from "../../../components/hs-scroll";
import { Button } from "../../../components/ui/button";
import { Tip } from "../../../components/ui/tooltip";
import { HEALTH_DOT, reprobe, useEndpointHealth } from "../../../lib/endpoint-health";
import { reportError } from "../../../lib/feedback";
import { cn } from "../../../lib/utils";

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
 *  端点枚带尾随重探钮时再叠 pr-1（§9 .ro-chip--act：右内距收到 --space-4，钮盒不顶圆角）。 */
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
        // 后台取快照失败分流：连接类走浮层（不留红字），业务类才就地（见 feedback.reportError）。
        if (current) setError(reportError(reason) ?? "");
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
    // 链容器＝§22 .lb-reqchain：内容给宽（flex 0 1 auto，不吃满）、缩到 120 保底
    // （「至少露一枚胶囊」＝任何组件不得缩到 0 的 enforce），再窄由 874 折行档接管——
    // 折行后掉第二行跨整行。胶囊 flex-none 不换行，超宽即横向溢出、由自绘拇指条接管
    // 。轨道间距 --space-12（hs 默认 --space-8）：globals 的
    // .hs-scroll 是无层声明、压过层内工具类，覆盖须带 important（globals.css「无层声明」注）。
    return (
      <section
        aria-label="策略配置"
        className="flex min-w-[120px] @max-[874px]/lbctx:col-span-full @max-[874px]/lbctx:row-start-2"
      >
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
          {/* 键列随 §10 .kv .k 实体（84px／--text-4）——16d 稿明文「不写死数值、随实体」；
              76px 是 16z1 设置行族（.wd-slabel）的裁决，用户 2026-10-11 裁「其他几处不管、
              症状不同构不推广」，.kv 实体未改档。 */}
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
          // 重探钮改既有档 icon-xs（22×22／图标 13）；补自己的 Tip（⑤）——
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
