import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../api";
import type { components } from "../../../api-types.gen";
import { reportError } from "../../../lib/feedback";

type IntegrityReport = components["schemas"]["IntegrityReport"];

/**
 * BatchOverview 的素材完整性查询域收拢：scanIntegrity 校验（含身份护栏
 * identity/active/requestId 与扫描互斥 busy）与报告状态；完成后全量同步
 * （exportRevision）触发对既有报告的重扫。换批次时查询域在此复位，并经
 * onIdentityReset 联动组件侧命令域的随行复位（先于任何取数，次序同拆分前）；
 * 排除打包与重打是命令类，留组件。跑批进入终态（running 回落）同样触发
 * 对既有报告的重扫——跑批中的素材变更与新产物只在该刻定型。
 */
export function useIntegrityScan(
  wid: string,
  batch: string,
  exportRevision: number,
  onIdentityReset: () => void,
  running?: boolean,
) {
  const [report, setReport] = useState<IntegrityReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const active = useRef(false);
  const requestId = useRef(0);
  const identity = useRef({ wid, batch });

  useEffect(() => {
    identity.current = { wid, batch };
    active.current = true;
    requestId.current += 1;
    busy.current = false;
    setReport(null);
    setChecking(false);
    setError("");
    onIdentityReset();
    return () => {
      active.current = false;
      requestId.current += 1;
    };
  }, [wid, batch, onIdentityReset]);

  const scan = useCallback(async () => {
    if (
      busy.current ||
      identity.current.wid !== wid ||
      identity.current.batch !== batch
    )
      return;
    busy.current = true;
    const version = ++requestId.current;
    setChecking(true);
    setError("");
    try {
      const result = await api.scanIntegrity(wid, batch);
      if (active.current && version === requestId.current) setReport(result);
    } catch (reason) {
      if (active.current && version === requestId.current)
        setError(reportError(reason) ?? "");
    } finally {
      if (active.current && version === requestId.current) {
        busy.current = false;
        setChecking(false);
      }
    }
  }, [wid, batch]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: full synchronization refreshes an existing integrity report, never per-item SSE events.
  useEffect(() => {
    if (report) void scan();
  }, [exportRevision]);

  // 已裁定（task.md 视觉遗留）：批次进入终态（跑批→结束）时自动重扫既有报告——
  // 只认 running 由 true 回落这一下，挂载即终态不扫；无报告时不凭空起扫。
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running && report) void scan();
    wasRunning.current = running;
  }, [running, report, scan]);

  return { report, checking, error, scan };
}
