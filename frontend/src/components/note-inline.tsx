/** 行内反馈条（稿 base.css §14 .note-inline 族的实现等价物，反馈形态归一批落位）：
 *  12px 单行省略、被截断时悬停给全文（Tip 承接，与 StrategyToolbar 行内失败槽同款）、
 *  四色语义档（info/ok/warn/bad）。fill＝弹性占满槽位中段（头行消息槽形态）；
 *  传 id 时供字段的 aria-describedby 程序化关联（DESIGN.md 七 9）。 */
import type { ReactElement } from "react";
import { cn } from "../lib/utils";
import { Tip } from "./ui/tooltip";

export type NoteInlineKind = "info" | "ok" | "warn" | "bad";

const KIND_CLASS: Record<NoteInlineKind, string> = {
  info: "text-info-ink",
  ok: "text-ok-ink",
  warn: "text-warn-ink",
  bad: "text-bad-ink",
};

export function NoteInline({
  kind,
  text,
  fill = false,
  role = "status",
  id,
  className,
}: {
  kind: NoteInlineKind;
  text: string;
  fill?: boolean;
  role?: "status" | "alert";
  id?: string;
  className?: string;
}): ReactElement {
  return (
    <Tip label={text}>
      <span
        id={id}
        role={role}
        className={cn(
          "min-w-0 max-w-full truncate text-t-sm",
          fill && "flex-1",
          KIND_CLASS[kind],
          className,
        )}
      >
        {text}
      </span>
    </Tip>
  );
}
