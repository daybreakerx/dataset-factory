import * as SelectPrimitive from "@radix-ui/react-select";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import type { ComponentProps, ReactElement } from "react";
import { createContext, useContext, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { Tip } from "./tooltip";

/** 关窗请求（族键盘范式：Tab／Shift+Tab＝关菜单、焦点移出）——Root 侧提供、Content 侧消费。 */
const SelectCloseContext = createContext<(() => void) | null>(null);

/** 族键盘范式（components/overlay.md「生命周期」2026-10-04）：Root 补一层受控/非受控桥，
 *  让 Content 能在 Tab 时主动请求关闭（Radix Content 拿不到 Root 的 setter）。 */
function Select({
  open,
  defaultOpen,
  onOpenChange,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Root>): ReactElement {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen ?? false);
  const isControlled = open !== undefined;
  const handleOpenChange = (next: boolean): void => {
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  return (
    <SelectCloseContext.Provider value={() => handleOpenChange(false)}>
      <SelectPrimitive.Root
        open={isControlled ? open : uncontrolledOpen}
        onOpenChange={handleOpenChange}
        {...props}
      >
        {children}
      </SelectPrimitive.Root>
    </SelectCloseContext.Provider>
  );
}
const SelectValue = SelectPrimitive.Value;

function SelectTrigger({
  className,
  children,
  onPointerEnter,
  onKeyDown,
  ref: forwardedRef,
  ...props
}: ComponentProps<typeof SelectPrimitive.Trigger>): ReactElement {
  const triggerRef = useRef<HTMLButtonElement>(null);
  // 触发件当前值被截断时悬停给全文（DESIGN.md 六「被截断的固定文字悬停给全文」；
  // 按溢出启停——值看得全就不出气泡）。文案在指针进入时现读，组件层一处、全部用例受益。
  const [tipText, setTipText] = useState("");
  return (
    <Tip label={tipText}>
      <SelectPrimitive.Trigger
        ref={(node) => {
          triggerRef.current = node;
          if (typeof forwardedRef === "function") forwardedRef(node);
          else if (forwardedRef != null) forwardedRef.current = node;
        }}
        data-slot="select-trigger"
        onPointerEnter={(event) => {
          onPointerEnter?.(event);
          const span = triggerRef.current?.querySelector("span");
          setTipText(
            span != null && span.scrollWidth > span.clientWidth + 1
              ? (span.textContent ?? "")
              : "",
          );
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) return;
          // 族口径：↑ 在触发件上不开层（触发件画的是向下的 ⌄，不承担向上开层职责）；
          // Radix Select 原生把 ArrowUp 计入 OPEN_KEYS，这里拦掉——默认阻止会让其内部处理跳过。
          if (event.key === "ArrowUp") event.preventDefault();
        }}
        className={cn(
          "flex h-(--h-lg) min-w-0 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-t-md whitespace-nowrap [&>span]:truncate",
          "hover:border-n-400 focus:border-n-400 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-muted disabled:text-n-400",
          "data-[placeholder]:text-text-4 [&_svg]:size-(--icon-md) [&_svg]:shrink-0 [&_svg]:text-text-3",
          className,
        )}
        {...props}
      >
        {children}
        <SelectPrimitive.Icon asChild>
          <ChevronDownIcon />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
    </Tip>
  );
}

function SelectContent({
  className,
  children,
  position = "popper",
  onKeyDown,
  ...props
}: ComponentProps<typeof SelectPrimitive.Content>): ReactElement {
  const requestClose = useContext(SelectCloseContext);
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) return;
          if (event.key === "Tab") {
            // 族键盘范式④：Tab／Shift+Tab＝关菜单、焦点移出（焦点回触发件由 Radix 关闭时自动完成）。
            event.preventDefault();
            requestClose?.();
          }
        }}
        className={cn(
          // 族配套（对齐批「表单 Select」残条）：浮层影随族 --sh-3（原 shadow-md）、
          // 宽度上限取族三段式的上限档（原有「下限＝触发件宽、可撑开」保持不动）。
          "relative z-50 max-h-(--radix-select-content-available-height) min-w-32 max-w-[min(480px,calc(100vw_-_32px))] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-(--sh-3)",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center">
          <ChevronUpIcon className="size-(--icon-md)" />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport
          className={cn(
            "p-1",
            position === "popper" && "w-full min-w-(--radix-select-trigger-width)",
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center">
          <ChevronDownIcon className="size-(--icon-md)" />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item>): ReactElement {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        // 行随族（对齐批「表单 Select 选中行与行取值归族」）：单行、行名 13px/500 text-2、
        // 四边内距 8、圆角 8；选中行 = tint/8 ＋主色描边槽 ＋名字主色（勾已裁撤）；
        // 当前行悬停不换底（stacked 变体压过 focus:bg-accent）。
        "relative flex w-full cursor-default items-center gap-2 rounded-md border border-transparent p-2 text-t-md font-medium text-text-2 outline-none select-none",
        "focus:bg-accent data-[disabled]:pointer-events-none data-[disabled]:text-n-400",
        "data-[state=checked]:border-primary/30 data-[state=checked]:bg-primary/8 data-[state=checked]:text-primary dark:data-[state=checked]:bg-primary/22",
        "data-[state=checked]:data-[highlighted]:bg-primary/8 dark:data-[state=checked]:data-[highlighted]:bg-primary/22",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
