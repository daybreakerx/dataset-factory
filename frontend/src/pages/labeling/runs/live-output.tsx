interface Props {
  wid: string;
  /** 跑批中的「当前产出」逐字流（A2）；null = 没有正在产出的条目。 */
  liveOutput: { item: string; reasoning: string; content: string };
}

/** 跑批中的「当前产出」展示块（A2，2026-09-21 审计定案）：逐字正文 + 思考折叠区。 */
export function LiveOutput({ wid, liveOutput }: Props) {
  return (
    <section
      className="mt-4 rounded-xl border border-border bg-card p-4"
      aria-label="当前产出"
    >
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-t-md font-medium">当前产出</h3>
        <span className="min-w-0 truncate text-t-sm text-text-3">
          {liveOutput.item}
        </span>
        <img
          src={`/api/workdirs/${encodeURIComponent(wid)}/items/${encodeURIComponent(liveOutput.item)}/asset`}
          alt=""
          className="ml-auto h-12 w-16 rounded-md object-cover"
        />
      </div>
      {liveOutput.reasoning !== "" && (
        <details open className="mb-2 rounded-lg border border-border bg-muted/40">
          <summary className="cursor-pointer px-3 py-2 text-t-sm text-text-3">
            思考过程（生成中展开 · 不保存）
          </summary>
          <p className="px-3 pb-3 text-t-md leading-(--lh-loose) text-text-3 whitespace-pre-wrap">
            {liveOutput.reasoning}
          </p>
        </details>
      )}
      {liveOutput.content === "" ? (
        <p className="text-t-sm text-text-4">正在组装请求…</p>
      ) : (
        <p className="text-t-md leading-(--lh-loose) whitespace-pre-wrap">
          {liveOutput.content}
          <span
            className="ml-0.5 inline-block h-[14px] w-[7px] bg-primary align-[-2px]"
            aria-hidden
          />
        </p>
      )}
    </section>
  );
}
