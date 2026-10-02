/**
 * 服务状态探测（壳层件）：侧栏脚注的服务状态点及其探测循环。
 * 自 App.tsx 收拢（批15 应用壳立层），逻辑与注释逐字随迁、零行为变化。
 */
import type { ReactElement } from "react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";

/**
 * 常驻探测间隔。
 *
 * 为什么要常驻：服务被脚本直接杀掉时页面收不到任何事件，只有主动探测才会把点转红。
 * 间隔取 30 秒——够快（配合「任一请求连不上就立刻重查」，用户实际操作时当场就红），也够慢
 * （视觉与请求基线每屏取数不到 30 秒，不会往基线里掺进不定数的探测请求）。
 */
const SERVICE_PROBE_MS = 30_000;
/** UI 上的关闭是优雅停机（等手头请求做完才退），确认期每秒探一次、探到不通就定在红点。 */
const STOPPING_PROBE_MS = 1_000;
const STOPPING_TRIES = 60;

/**
 * 侧栏脚注的服务状态点（components/shell.md「状态点 + 版本号」组合口径）。
 *
 * 数据 = GET /api/service，不为点编造状态（components/marks.md）。探测时机四处：进页、窗口聚焦、
 * `df:service-changed`（任何一次请求连不上后端时由 `reportError` 广播）、常驻低频轮询。
 * 「正在停止」是点上的第四个状态：UI 关闭被受理但服务还在排空请求，这段时间既不是运行中
 * 也不是不可用，如实标出来（与「关闭前会等正在进行的请求跑完」的弹窗文案同一个事实）。
 */
export function ServiceDot(): ReactElement {
  const [state, setState] = useState<"probing" | "ok" | "stopping" | "bad">("probing");
  const refresh = useCallback(() => {
    void api.getService().then(
      () => setState("ok"),
      () => setState("bad"),
    );
  }, []);
  useEffect(() => {
    refresh();
    const onWake = (): void => refresh();
    const onStopping = (): void => setState("stopping");
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, SERVICE_PROBE_MS);
    window.addEventListener("focus", onWake);
    window.addEventListener("df:service-changed", onWake);
    window.addEventListener("df:service-stopping", onStopping);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("df:service-changed", onWake);
      window.removeEventListener("df:service-stopping", onStopping);
    };
  }, [refresh]);
  const stopping = state === "stopping";
  useEffect(() => {
    if (!stopping) {
      return;
    }
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      void api.getService().then(
        () => {
          // 排空得比确认期慢（例如正在跑一轮长生成）：不谎报，退回常驻节奏继续探测。
          if (tries >= STOPPING_TRIES) setState("ok");
        },
        () => setState("bad"),
      );
    }, STOPPING_PROBE_MS);
    return () => window.clearInterval(timer);
  }, [stopping]);
  const label =
    state === "ok"
      ? "服务运行中"
      : state === "bad"
        ? "服务不可用"
        : state === "stopping"
          ? "正在停止服务"
          : "正在检测服务";
  const cls =
    state === "ok"
      ? "bg-ok-dot"
      : state === "bad"
        ? "bg-bad-dot"
        : "bg-info-dot animate-pulse";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={label}
          className={`inline-block size-1.5 rounded-full ${cls}`}
        />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
