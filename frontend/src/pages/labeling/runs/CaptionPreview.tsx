import { useEffect, useRef, useState } from "react";
import { ApiError, api, errorMessage } from "../../../api";
import type { components } from "../../../api-types.gen";
import { FormError } from "../../../components/form-error";
import { cn } from "../../../lib/utils";
import { ComparePicker } from "./compare-picker";

interface Props {
  wid: string;
  batch: string;
  row: components["schemas"]["ItemRowView"];
  batches?: readonly components["schemas"]["BatchView"][];
  /** 当前批次之外、激活态、可参与对比的批次。 */
  available: components["schemas"]["BatchView"][];
  /** 已加入对比的批次 id（名单与替换式上限由父视图统一管）。 */
  compared: string[];
  onToggleCompared: (id: string) => void;
  /** 媒体舞台折叠态：解除各栏正文 180px 上限（稿 §23 .capbox--unfolded）。 */
  unfolded: boolean;
}

/** 对比栏正文：取数中「正在读取…」与无产物「暂无产出」分两句（⑤，DESIGN.md 4.2）。 */
function bodyText(loading: boolean, text: string, empty: string): string {
  return loading ? "正在读取…" : text.trim() || empty;
}

/** 对比栏正文的三档字色：取数中 --text-4／无产物 --text-3／有产物正文色。 */
function bodyTone(loading: boolean, text: string): string {
  return loading ? "text-text-4" : text.trim() ? "text-foreground" : "text-text-3";
}

function ComparisonCaption({
  wid,
  batch,
  item,
}: {
  wid: string;
  batch: string;
  item: string;
}) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    setText("");
    setLoading(true);
    setError("");
    void api
      .readCaption(wid, batch, item)
      .then((value) => {
        if (current) setText(value);
      })
      .catch((reason: unknown) => {
        if (!current) return;
        if (!(reason instanceof ApiError && reason.status === 404))
          setError(errorMessage(reason));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [wid, batch, item]);
  return (
    <div
      className={cn(
        "p-3 text-t-sm leading-(--lh-base) whitespace-pre-wrap break-words",
        !error && bodyTone(loading, text),
      )}
      aria-busy={loading}
    >
      {error ? (
        <FormError className="text-bad-ink">{error}</FormError>
      ) : (
        bodyText(loading, text, "暂无产出")
      )}
    </div>
  );
}

/**
 * 产出区·已完成态（稿「产出区」格 ⑥—⑪）：题字行（已产出＋对比 chips）＋产物框（单栏或多栏）。
 *
 * 只读产物，不提供名单编辑——「加入重试」整枚 2026-10-11 用户裁撤（⑪），
 * 名单动作归左列条目行内那一枚（同一后端动作、不留第二个入口）。
 */
export function CaptionPreview({
  wid,
  batch,
  row,
  batches = [],
  available,
  compared,
  onToggleCompared,
  unfolded,
}: Props) {
  const [caption, setCaption] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    let current = true;
    setCaption("");
    setError("");
    setLoading(true);
    void api
      .readCaption(wid, batch, row.item)
      .then((text) => {
        if (current) setCaption(text);
      })
      .catch((reason: unknown) => {
        if (current && !(reason instanceof ApiError && reason.status === 404)) {
          setError(errorMessage(reason));
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
      generation.current += 1;
    };
  }, [wid, batch, row]);

  const columns = compared.length ? [batch, ...compared] : [batch];
  return (
    <section className="mt-4 min-w-0" aria-label="产物预览">
      <div className="mb-2 flex min-w-0 items-baseline gap-3">
        <h3 className="shrink-0 text-t-md font-medium">已产出</h3>
        {!!available.length && (
          <ComparePicker
            batch={batch}
            batches={batches}
            available={available}
            compared={compared}
            onToggle={onToggleCompared}
          />
        )}
      </div>
      {error && <FormError className="mb-3 text-t-sm text-bad-ink">{error}</FormError>}
      {!compared.length ? (
        // 单栏＝.capbox（白卡＋r-lg＋180 内滚）
        <section
          className={cn(
            "rounded-xl border border-border bg-card p-4 text-t-md leading-(--lh-loose) whitespace-pre-wrap break-words",
            bodyTone(loading, caption),
            !unfolded && "max-h-[180px] overflow-y-auto",
          )}
          aria-label={`产物 ${batch}`}
          aria-busy={loading}
        >
          {/* A3 显示层兜底：老产物可能带前导空行，展示前去掉（产物文件本身不动）。 */}
          {bodyText(loading, caption, "暂无产出")}
        </section>
      ) : (
        // 多栏＝.cmp-grid／.cmp-col（每栏各自锁 180 内滚；当前策略恒在第一栏）
        <div
          className="grid gap-3"
          style={{
            gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))`,
          }}
        >
          {columns.map((id) => (
            <section
              key={id}
              className="min-w-0 overflow-hidden rounded-lg border border-border bg-card"
              aria-label={`产物 ${id}`}
            >
              <h4 className="flex items-center gap-2 border-b border-border px-3 py-2 text-t-sm text-text-3">
                {batches.find((entry) => entry.id === id)?.name ?? id} · {id}
              </h4>
              {id === batch ? (
                <div
                  className={cn(
                    "p-3 text-t-sm leading-(--lh-base) whitespace-pre-wrap break-words",
                    bodyTone(loading, caption),
                    !unfolded && "max-h-[180px] overflow-y-auto",
                  )}
                  aria-busy={loading}
                >
                  {bodyText(loading, caption, "暂无产出")}
                </div>
              ) : (
                <ComparisonCaption wid={wid} batch={id} item={row.item} />
              )}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
