import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import type { ReactElement } from "react";

import type { ThemeMode } from "../hooks/use-theme";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/** 三态循环：跟随系统 → 亮色 → 暗色 → 跟随系统。 */
const CYCLE: readonly ThemeMode[] = ["system", "light", "dark"];

const MODE_LABEL: Record<ThemeMode, string> = {
  system: "跟随系统",
  light: "浅色模式",
  dark: "深色模式",
};

function modeIcon(mode: ThemeMode) {
  return mode === "system" ? MonitorIcon : mode === "light" ? SunIcon : MoonIcon;
}

/** 主题切换按钮：点击在三态间循环，选择记进 localStorage（跟随系统时实时响应系统切换）。 */
export function ThemeToggle({
  sidebar = false,
  mode,
  onModeChange,
}: {
  sidebar?: boolean;
  mode: ThemeMode;
  onModeChange: (mode: ThemeMode) => void;
}): ReactElement {
  // noUncheckedIndexedAccess 下数组下标访问带 undefined，兜底回 system（三态循环不会真走到）。
  const next =
    (CYCLE[(CYCLE.indexOf(mode) + 1) % CYCLE.length] satisfies ThemeMode | undefined) ??
    "system";
  const Icon = modeIcon(mode);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={sidebar ? "ghost" : "outline"}
          size="icon"
          className={
            sidebar
              ? "text-text-3 hover:bg-accent hover:text-text-1"
              : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          }
          aria-label={MODE_LABEL[mode]}
          onClick={() => onModeChange(next)}
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{MODE_LABEL[mode]}</TooltipContent>
    </Tooltip>
  );
}
