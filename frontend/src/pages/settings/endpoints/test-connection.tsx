/** 连接 · 端点配置 · 测试连接行（按钮 + 结果回显 + 实际发送参数回显）。 */
import type { ReactElement } from "react";
import type { EndpointTestResult } from "../../../api";
import { Button } from "../../../components/ui/button";

type TestConnectionProps = {
  testing: boolean;
  /** 按钮禁用条件由面板计算（testing ＋ Base URL / 模型名称必填校验）。 */
  disabled: boolean;
  result: EndpointTestResult | null;
  onTest: () => void;
};

/** 测试连接：飞行期禁用并显示「测试中…」；成功回显耗时，失败回显后端分类提示。 */
export function TestConnection({
  testing,
  disabled,
  result,
  onTest,
}: TestConnectionProps): ReactElement {
  return (
    <>
      <div className="flex items-center gap-2.5">
        <Button
          type="button"
          variant="accent"
          size="sm"
          disabled={disabled}
          onClick={onTest}
        >
          {testing ? "测试中…" : "测试连接"}
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
      {result?.ok && result.effective_params != null && (
        <p className="text-t-xs text-muted-foreground">
          本次实际发送：
          {Object.entries(result.effective_params)
            .map(([key, value]) =>
              value !== null && typeof value === "object"
                ? `${key}=${JSON.stringify(value)}`
                : `${key}=${String(value)}`,
            )
            .join(" · ")}
        </p>
      )}
    </>
  );
}
