import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../api";
import { DialogShell } from "../../../components/dialog-shell";
import { FormError } from "../../../components/form-error";
import { reportError } from "../../../lib/feedback";
import { formatBytesAuto } from "../../../lib/format";

type Entry = { name: string; size: number; modified_at: number };

/** 记录卡首行：本地时间「YYYY-MM-DD HH:MM:SS」（稿给到秒、不带时区后缀）。 */
function stamp(seconds: number): string {
  const date = new Date(seconds * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * 「清理运行记录」弹窗（通用件 · 单份解释确认型 · 620 档）。
 *
 * 它是 ADR 2026-10-09「运行流水损坏的出口就地给」的落点：设置页那个独立入口撤了，
 * 损坏在哪一处报出来，红字旁边就是这一扇窗。恒定单份预选中——`run` 由后端错体的
 * `extras_from="run"` 带出（＝清理端点 `names` 的取值），所以窗里没有清单、没有勾选、
 * 没有截断，只有「这份坏了、清掉它会怎样、要不要清」。
 *
 * 取数复用既有全量预览端点再按名命中：清单量级是个位数，为单份加一个查询参数不值。
 * 六态＝常态／取数中／取数失败／清理飞行／清理失败／残留；本实例页脚不画分隔线（稿
 * `.modal.cr .modal-foot`），所以失败行不挂 `data-dialog-error`——那是页脚线的触发器。
 */
export function CleanupRunDialog({
  wid,
  run,
  onClose,
  onCleaned,
}: {
  wid: string;
  run: string;
  onClose: () => void;
  /** 清理成功后回给调用方：各面据此就地重拉自己的取数，红字随句自消。 */
  onCleaned: () => void;
}) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cleanError, setCleanError] = useState("");
  const [residual, setResidual] = useState<string | null>(null);
  const generation = useRef(0);
  const active = useRef(true);
  const submitting = useRef(false);
  useEffect(
    () => () => {
      active.current = false;
    },
    [],
  );

  // 取数只依赖 wid／run；「重新读取」重调本函数即可，不另挂重试令牌。
  const load = useCallback(() => {
    const token = ++generation.current;
    setLoading(true);
    setError("");
    void api
      .previewRunCleanup(wid)
      .then(
        (rows) => {
          if (generation.current !== token) return;
          const hit = rows.find((row) => row.name === run);
          if (!hit) {
            // 记录已不在＝已变化：沿条内裁定的稿定句，不另造文案。
            setError("运行记录已变化，请重新进入。");
            setEntry(null);
            return;
          }
          setEntry({
            name: hit.name,
            size: hit.size,
            modified_at: hit.modified_at,
          });
        },
        (reason: unknown) => {
          if (generation.current === token) setError(reportError(reason) ?? "");
        },
      )
      .finally(() => {
        if (generation.current === token) setLoading(false);
      });
  }, [wid, run]);

  useEffect(() => {
    load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  async function clean() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setCleanError("");
    try {
      const result = await api.cleanupWorkdir(wid, "runs", [run]);
      if (!active.current) return;
      onCleaned();
      const left = result.recovery_path;
      if (left?.trim()) {
        setResidual(left);
        return;
      }
      onClose();
    } catch (reason) {
      if (active.current) setCleanError(reportError(reason) ?? "");
    } finally {
      submitting.current = false;
      if (active.current) setBusy(false);
    }
  }

  const readFailed = !loading && error !== "";

  return (
    <DialogShell
      open
      onOpenChange={(open) => {
        // 全站通用口径（2026-10-11 用户裁「退出不取消任务」）：飞行期 Esc 与关闭钮照常可退，
        // 关掉的是界面、清理照常跑完；迟到的回包不再回唤已卸载的本窗（active 闸门）。
        if (!open) onClose();
      }}
      className="max-h-[90dvh] w-[min(var(--w-modal-620),calc(100vw-48px))] overflow-y-auto"
      title="清理运行记录"
      hardWarn="清理后不可恢复"
      closeTip={busy ? "关闭不等于撤销删除" : undefined}
      // 页脚三态（稿文案节）：常态＝取消／清理这份记录；取数失败＝取消／重新读取；残留＝关闭。
      // 飞行期两钮「只失效不换装」交壳级 flight 落实（挂 disabled 会进灰阶）。
      flight={busy}
      cancel={
        residual ? undefined : { label: "取消", variant: "secondary", onClick: onClose }
      }
      confirm={
        residual
          ? { label: "关闭", variant: "secondary", onClick: onClose }
          : loading
            ? undefined
            : readFailed
              ? { label: "重新读取", variant: "secondary", onClick: load }
              : {
                  label: busy ? "正在清理" : "清理这份记录",
                  variant: "danger-text",
                  onClick: () => void clean(),
                }
      }
    >
      {residual ? (
        <div>
          {/* 残留尾态（稿格 6，2026-10-11 用户裁两句并作一句）：琥珀句承载＋浅底路径框。 */}
          <p role="status" className="mb-4 text-t-sm text-warn-ink">
            运行记录已清理，暂存目录清理时遇到问题，不影响功能，可自行清理：
          </p>
          <p className="break-all rounded-md bg-muted p-3 text-t-sm text-text-2 tabular-nums">
            {residual}
          </p>
        </div>
      ) : loading ? (
        <p role="status" className="px-2 py-4 text-center text-t-sm text-text-3">
          正在读取记录信息
        </p>
      ) : readFailed ? (
        <FormError className="text-t-sm text-bad-ink">{error}</FormError>
      ) : (
        entry && (
          <>
            <div>
              <p className="mb-4 text-t-sm text-text-2">
                该批次有 1
                份运行记录已损坏，导致条目、导出等功能的读取报错。清理这份记录后即可恢复正常。
              </p>
              <div className="mb-4 flex flex-col gap-0.5 rounded-md bg-muted p-3">
                <span className="text-t-md font-medium text-text-1 tabular-nums">
                  {stamp(entry.modified_at)}
                </span>
                <span className="text-t-xs text-text-3 tabular-nums">
                  {entry.name} · {formatBytesAuto(entry.size)}
                </span>
              </div>
              <div className="mb-3">
                <p className="mb-2 text-t-sm font-semibold text-text-1">清理后</p>
                <ul className="list-disc space-y-1.5 pl-[18px] text-t-sm text-text-2">
                  <li>
                    相关条目的产物时效将显示「无法校验」（判断依据随记录移除）；重新打标后恢复
                  </li>
                  <li>这次运行的失败原因与尝试次数一并移除</li>
                </ul>
              </div>
              <p className="text-t-sm text-text-2">
                <b className="font-semibold text-text-1">不受影响</b>
                ：素材、打标产物、其他运行记录与打包导出。
              </p>
            </div>
            {cleanError && (
              <FormError className="mt-4 text-t-sm text-bad-ink">
                {cleanError}
              </FormError>
            )}
          </>
        )
      )}
    </DialogShell>
  );
}
