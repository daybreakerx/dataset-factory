import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { CheckIcon } from "lucide-react";
import type { ComponentProps, ReactElement } from "react";
import { createContext, useContext, useEffect, useRef, useState } from "react";

import { cn } from "../../lib/utils";

/** 弹层状态（族键盘范式用）：open＝展开态（聚焦落点 effect 的触发源）；
 *  requestClose＝关窗请求（Tab／Shift+Tab＝关菜单、焦点移出）——Root 侧提供、Content 侧消费。 */
const DropdownMenuStateContext = createContext<{
  open: boolean;
  requestClose: () => void;
} | null>(null);

/** 族键盘范式（components/overlay.md「生命周期」2026-10-04 选择器范式）：Root 补一层
 *  受控/非受控桥，让 Content 能在 Tab 时主动请求关闭（Radix Content 拿不到 Root 的 setter）。 */
function DropdownMenu({
  open,
  defaultOpen,
  onOpenChange,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Root>): ReactElement {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen ?? false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : uncontrolledOpen;
  const handleOpenChange = (next: boolean): void => {
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  return (
    <DropdownMenuStateContext.Provider
      value={{ open: isOpen, requestClose: () => handleOpenChange(false) }}
    >
      <DropdownMenuPrimitive.Root
        open={isOpen}
        onOpenChange={handleOpenChange}
        {...props}
      >
        {children}
      </DropdownMenuPrimitive.Root>
    </DropdownMenuStateContext.Provider>
  );
}
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

function DropdownMenuContent({
  className,
  sideOffset = 4,
  onKeyDown,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>): ReactElement {
  const contentRef = useRef<HTMLDivElement>(null);
  const menuState = useContext(DropdownMenuStateContext);
  const open = menuState?.open ?? false;
  useEffect(() => {
    // 选择器范式①：开层后焦点落「当前项」（无当前项落首个可用项；全无选项时兜底聚焦容器，
    // Esc 与键盘导航照常可用）。挂「open 翻真」而非挂载——本组件随实例常驻、Content 才随开层挂；
    // Radix 默认先聚焦容器，本效果随后把焦点挪到目标行。
    if (!open) return;
    const content = contentRef.current;
    if (content === null) return;
    const target =
      content.querySelector<HTMLElement>(
        '[role="menuitem"][data-current]:not([data-disabled])',
      ) ?? content.querySelector<HTMLElement>('[role="menuitem"]:not([data-disabled])');
    (target ?? content).focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    // T16 保活切页自愈（挂起清单「保活切页 aria-hidden 残留」）：弹窗开着跨切页往返时，
    // 两层（dialog＋menu）hideOthers 的 effect 在 Activity 隐藏期卸载、切回重建——重建的
    // 时序会把本菜单的 portal 壳误标 aria-hidden（菜单看得见点得动、可及性树里整块消失）。
    // 修法＝菜单打开期间，下一帧把自家 portal 壳上的误标清掉（菜单开着时必须可及，被标即误标）；
    // 晚于两层 hideOthers 的 commit effect 执行，不改任何 UX（关层后的恢复仍由 Radix 接管）。
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const wrapper = contentRef.current?.parentElement ?? null;
      if (wrapper === null) return;
      if (wrapper.getAttribute("aria-hidden") === "true") {
        wrapper.removeAttribute("aria-hidden");
        wrapper.removeAttribute("data-aria-hidden");
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={contentRef}
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-40 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-md",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className,
        )}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) return;
          if (event.key === "Tab") {
            // 选择器范式④：Tab／Shift+Tab＝关菜单、焦点移出——焦点回触发件由 Radix 关闭时
            // 自动完成，再按 Tab 继续按页内顺序走（不再困在弹层里）。
            event.preventDefault();
            menuState?.requestClose();
          }
        }}
        {...props}
      >
        {children}
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuItem({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] outline-none select-none",
        "focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        "[&_svg]:size-(--icon-md) [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuCheckboxItem({
  className,
  children,
  withIndicator = true,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem> & {
  /** 行首对勾指示器：族多选勾选行（.cb 复选框为信号）不取——族规则「无对勾」（overlay.md）。 */
  withIndicator?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-7 text-[13px] outline-none select-none",
        "focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      {withIndicator && (
        <span className="absolute left-2 flex size-3.5 items-center justify-center">
          <DropdownMenuPrimitive.ItemIndicator>
            <CheckIcon className="size-(--icon-md)" />
          </DropdownMenuPrimitive.ItemIndicator>
        </span>
      )}
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuLabel({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      className={cn("px-2 py-1.5 text-t-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
};
