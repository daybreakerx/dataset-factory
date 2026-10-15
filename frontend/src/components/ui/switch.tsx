import * as SwitchPrimitive from "@radix-ui/react-switch";
import type { ComponentProps } from "react";

import { cn } from "../../lib/utils";

/** 开关：二态「启用 / 停用」用开关，「从集合中多选」用复选框（design「开关与复选框的语义区分」）。 */
function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-[18px] w-8 shrink-0 items-center rounded-full border border-transparent transition-colors",
        // 这里不能加 focus-visible:ring：--ring 不在主题里，ring-2 会退化成
        // var(…, currentcolor)、画出 2px 正文色实心环（2026-09-20 实测过）；
        // 键盘焦点指示走全局 :focus-visible 环。
        "disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-3.5 rounded-full bg-card shadow-sm ring-0 transition-transform",
          "data-[state=checked]:translate-x-3.5 data-[state=unchecked]:translate-x-0.5",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
