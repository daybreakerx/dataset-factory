/** 端点配置切换器（chip = 「名称 · 模型」；页内局部选择器——选中记忆纯会话内，刷新后随策略恢复）。
 *  族内实例（components/cfg-pop.tsx）：触发件＝chip、行单行「名字 · 模型」、头行钮＝去设置管理、
 *  无未保存拦截（策略行改动作级实时保存后切换端点即提交）；取数失败落层内一行、重开即重拉。 */
import { ChevronDownIcon, SettingsIcon } from "lucide-react";
import { type ReactElement, useState } from "react";
import type { EndpointConfigSummary } from "../../../api";
import {
  CfgPopContent,
  CfgPopHead,
  CfgPopRow,
  CfgPopRowMain,
  CfgPopStateRow,
} from "../../../components/cfg-pop";
import { Button } from "../../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { Tip } from "../../../components/ui/tooltip";
import {
  HEALTH_DOT,
  HEALTH_DOT_BREATHING,
  useEndpointHealth,
} from "../../../lib/endpoint-health";

export function EndpointSwitcher({
  endpoints,
  selectedId,
  disabled = false,
  loading = false,
  failed = false,
  onMenuOpen,
  onSelect,
  onManage,
}: {
  endpoints: EndpointConfigSummary[];
  /** 页内当前选中的配置 ID（空串 = 未选）；显示按 ID 现查，指向已删配置时显示未配置端点。 */
  selectedId: string;
  /** 配置飞行中（策略应用 / 提示词保存任一）：触发件与行只失效不换装（族口径）。 */
  disabled?: boolean;
  /** 端点列表取数中／取数失败（弹层三态行；打开即重拉的飞行态）。 */
  loading?: boolean;
  failed?: boolean;
  /** 每次打开弹层重拉端点列表（打开＝重试；先例＝策略下拉）。 */
  onMenuOpen?: () => void;
  onSelect: (cid: string) => void;
  onManage: () => void;
}): ReactElement {
  const selected = endpoints.find((item) => item.id === selectedId);
  // chip 状态点接真实健康探测（稿 端点切换弹层
  // 「触发件 · 点色四态」）：语义与打标页同套（共用 hook），探测中走呼吸蓝——本页无
  // 跑批呼吸点同屏竞争；未配置端点 = 静态灰（灰点说真话、无从探起）。
  const health = useEndpointHealth(selected?.name ?? "", selected);
  // chip 显示「名称 · 模型」、被触发件宽度截断时悬停给全文（DESIGN.md 六）——
  // 按溢出启停（select 触发器同口径）：值看得全就不出全文气泡、保留切换功能提示。
  const chipText = selected ? `${selected.name} · ${selected.model}` : "未配置端点";
  const [chipTip, setChipTip] = useState("切换端点配置");
  // 计数不可知（首取中／取数失败）时头行只写库名，不写假计数（overlay.md 头行条）。
  const countKnown = !failed && !(loading && endpoints.length === 0);
  return (
    <DropdownMenu
      onOpenChange={(next) => {
        if (next) onMenuOpen?.();
      }}
    >
      <Tip label={chipTip}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-w-0 max-w-60 shrink gap-2 px-2 text-t-md font-medium text-text-2 enabled:hover:bg-accent enabled:hover:text-text-1 disabled:bg-transparent disabled:text-text-2 [&_svg]:size-3"
            aria-label="端点配置切换器"
            disabled={disabled}
            onPointerEnter={(event) => {
              // 标签是第二枚 span（第一枚是状态点）——按类定位，别按序数。
              const span = event.currentTarget.querySelector("span.truncate");
              setChipTip(
                span != null && span.scrollWidth > span.clientWidth + 1
                  ? chipText
                  : "切换端点配置",
              );
            }}
          >
            <span
              aria-hidden
              className={`size-1.5 shrink-0 rounded-full ${
                selected ? HEALTH_DOT_BREATHING[health.status] : HEALTH_DOT.unknown
              }`}
            />
            <span className="min-w-0 truncate">{chipText}</span>
            <ChevronDownIcon className="shrink-0" />
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <CfgPopContent anchor="trigger" align="start" side="bottom">
        <CfgPopHead
          label={countKnown ? `端点 · 共 ${endpoints.length} 条` : "端点"}
          action={{
            label: "前往设置 · 端点配置",
            icon: <SettingsIcon />,
            onClick: onManage,
          }}
        />
        <div className="max-h-80 overflow-y-auto">
          {loading && endpoints.length === 0 ? (
            <CfgPopStateRow>正在读取…</CfgPopStateRow>
          ) : failed ? (
            <CfgPopStateRow>端点读取失败</CfgPopStateRow>
          ) : endpoints.length === 0 ? (
            <CfgPopStateRow>还没有可用的端点</CfgPopStateRow>
          ) : (
            endpoints.map((item) => (
              <CfgPopRow
                key={item.id}
                current={item.id === selectedId}
                disabled={disabled}
                onSelect={() => onSelect(item.id)}
              >
                <CfgPopRowMain name={`${item.name} · ${item.model}`} />
              </CfgPopRow>
            ))
          )}
        </div>
      </CfgPopContent>
    </DropdownMenu>
  );
}
