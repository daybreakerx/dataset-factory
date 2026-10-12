import type { ReactElement, ReactNode } from "react";
import { useState } from "react";

/**
 * 媒体缩略图帧（行内小格用）：图片走 `<img loading="lazy">`、视频走 `#t=0.1`
 * 媒体片段＋`preload="metadata"`（浏览器只取首帧，不整段下载——解不出编码时落调用方
 * 图标回退）。失败回退由调用方给（各行／各槽的图标档位不同）。
 *
 * 2026-10-13 第二条使用者出现时上提（先例＝prompt-workbench/chat/MessageList 的
 * 附件缩略图；本项目「出现第二个使用者就上提、不留副本」）。
 */
export function MediaThumb({
  src,
  kind,
  fallback,
}: {
  src: string;
  kind: "image" | "video";
  fallback: ReactNode;
}): ReactElement {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <>{fallback}</>;
  }
  if (kind === "video") {
    return (
      <video
        src={`${src}#t=0.1`}
        preload="metadata"
        muted
        playsInline
        tabIndex={-1}
        aria-hidden
        onError={() => setFailed(true)}
        className="pointer-events-none size-full object-cover"
      />
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="size-full object-cover"
    />
  );
}
