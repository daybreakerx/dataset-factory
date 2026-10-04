/** 连接 · 端点配置 · 测试连接行（按钮＋结果字）。 */
import type { ReactElement } from "react";
import type { EndpointTestResult } from "../../../api";
import { Button } from "../../../components/ui/button";

type TestConnectionProps = {
  testing: boolean;
  /** 按钮禁用条件由面板计算（Base URL / 模型名称必填校验；testing 是瞬态、不进 disabled）。 */
  disabled: boolean;
  result: EndpointTestResult | null;
  onTest: () => void;
};

/** 测试连接：飞行归载入档（data-loading＝文字透明占位＋转圈、底保持 accent 不灰——
 *  探测属可感知等待的操作；防重入由 data-loading 的 pointer-events 与面板键盘守卫承担）；
 *  结果字随反馈形态归一改族的事在批 14 收尾，本行只承载文案与耗时。 */
export function TestConnection({
  testing,
  disabled,
  result,
  onTest,
}: TestConnectionProps): ReactElement {
  return (
    <div className="flex items-center gap-3">
      <Button
        type="button"
        variant="accent"
        size="sm"
        data-loading={testing || undefined}
        disabled={disabled}
        onClick={onTest}
        className="relative data-[loading=true]:pointer-events-none data-[loading=true]:text-transparent"
      >
        {testing && (
          <span
            aria-hidden
            className="absolute inset-0 m-auto size-[13px] animate-spin rounded-full border-2 border-n-300 border-t-text-1"
          />
        )}
        测试连接
      </Button>
      {result !== null && (
        <span
          className={`text-t-sm ${result.ok ? "text-success" : "text-destructive"}`}
          role="status"
        >
          {result.message}
          {result.ok ? ` · ${Math.round(result.latency_ms)} ms` : ""}
        </span>
      )}
    </div>
  );
}
