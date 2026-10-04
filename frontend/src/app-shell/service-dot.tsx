/**
 * 服务状态探测（壳层件）：侧栏脚注的服务状态点及其探测循环。
 * 探测状态机抽成 useServiceProbe（运行日志子页的状态行同吃这一套四态与数据，
 * 「状态栏和运行日志合并为一个整页面」的头行即状态行——2026-10-05 用户裁）。
 */
import type { ReactElement } from "react";
import { useCallback, useEffect, useState } from "react";
import type { ServiceStatus } from "../api";
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

export type ServiceProbeState = "probing" | "ok" | "stopping" | "bad";

/**
 * 服务四态探测状态机（GET /api/service，不为状态编造状态——components/marks.md）。
 * 探测时机四处：挂载、窗口聚焦、`df:service-changed`（任何一次请求连不上后端时由
 * `reportError` 广播）、常驻低频轮询。返回探测状态与最近一次成功响应的 status 数据
 * （「正在停止」沿用最后一次已知数据渲染监听信息；probing 阶段无已确认数据、不显示）。
 */
export function useServiceProbe(): {
  state: ServiceProbeState;
  status: ServiceStatus | null;
} {
  const [state, setState] = useState<ServiceProbeState>("probing");
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const refresh = useCallback(() => {
    void api.getService().then(
      (next) => {
        setStatus(next);
        setState("ok");
      },
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
        (next) => {
          setStatus(next);
          // 排空得比确认期慢（例如正在跑一轮长生成）：不谎报，退回常驻节奏继续探测。
          if (tries >= STOPPING_TRIES) setState("ok");
        },
        () => setState("bad"),
      );
    }, STOPPING_PROBE_MS);
    return () => window.clearInterval(timer);
  }, [stopping]);
  return { state, status };
}

/** 四态 → 状态点配色（probing／stopping＝呼吸蓝，§5 dot 族口径）。 */
export function serviceDotClass(state: ServiceProbeState): string {
  return state === "ok"
    ? "bg-ok-dot"
    : state === "bad"
      ? "bg-bad-dot"
      : "bg-info-dot animate-pulse";
}

/**
 * 侧栏脚注的服务状态点（components/shell.md「状态点 + 版本号」组合口径）。
 * 「正在停止」是点上的第四个状态：UI 关闭被受理但服务还在排空请求，这段时间既不是
 * 运行中也不是不可用，如实标出来（与「关闭前会等正在进行的请求跑完」的弹窗文案同一事实）。
 */
export function ServiceDot({
  labelSuffix = "",
}: {
  /** 附加在状态文案尾部的后缀（折叠态传「 · 版本号」，四态同式；aria 与 Tip 同文随动）。 */
  labelSuffix?: string;
}): ReactElement {
  const { state } = useServiceProbe();
  const label =
    (state === "ok"
      ? "服务运行中"
      : state === "bad"
        ? "服务不可用"
        : state === "stopping"
          ? "正在停止服务"
          : "正在检测服务") + labelSuffix;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={label}
          className={`inline-block size-1.5 rounded-full ${serviceDotClass(state)}`}
        />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
