/** 端点配置切换器（chip = 「名称 · 模型名」；页内局部选择器——选中记忆纯会话内，刷新后随策略恢复）。 */
import { ChevronDownIcon } from "lucide-react";
import type { ReactElement } from "react";
import type { EndpointConfigSummary } from "../../../api";
import { Button } from "../../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";

export function EndpointSwitcher({
  endpoints,
  selectedId,
  disabled = false,
  onSelect,
  onManage,
}: {
  endpoints: EndpointConfigSummary[];
  /** 页内当前选中的配置 ID（空串 = 未选）；显示按 ID 现查，指向已删配置时显示未配置端点。 */
  selectedId: string;
  disabled?: boolean;
  onSelect: (cid: string) => void;
  onManage: () => void;
}): ReactElement {
  const selected = endpoints.find((item) => item.id === selectedId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-w-0 max-w-60 shrink px-2 text-t-md text-text-2"
          aria-label="端点配置切换器"
          disabled={disabled}
        >
          <span className="truncate">
            {selected ? `${selected.name} · ${selected.model}` : "未配置端点"}
          </span>
          <ChevronDownIcon className="size-3 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>端点配置</DropdownMenuLabel>
        {endpoints.length === 0 && (
          <DropdownMenuLabel>（还没有配置——去「管理配置」新增）</DropdownMenuLabel>
        )}
        {endpoints.map((item) => (
          <DropdownMenuItem
            key={item.name}
            disabled={disabled}
            onSelect={() => onSelect(item.id)}
          >
            <span className="flex-1 truncate">
              {item.name} · {item.model}
            </span>
            {item.id === selectedId && (
              <span className="size-2 rounded-full bg-success" />
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={disabled} onSelect={onManage}>
          管理配置…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
