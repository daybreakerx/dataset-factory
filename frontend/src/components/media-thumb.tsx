import type { ReactElement, ReactNode } from "react";
import { useState } from "react";

/**
 * 媒体缩略图帧（行内小格用）：图片与视频都**挂载即发**——图片走 `<img>`（不带 `loading="lazy"`）、
 * 视频走 `#t=0.1` 媒体片段＋`preload="metadata"`（浏览器只取首帧，不整段下载——解不出编码时
 * 落调用方图标回退）。失败回退由调用方给（各行／各槽的图标档位不同）。
 *
 * 2026-10-13 第二条使用者出现时上提（先例＝prompt-workbench/chat/MessageList 的
 * 附件缩略图；本项目「出现第二个使用者就上提、不留副本」）。**同日晚图片撤 lazy**：
 * 视频本就挂载即发（`preload="metadata"` 无懒机制）、图片单独 lazy 两形态不配平，
 * 且 IO 首回调时机受浏览器调度与环境影响——同屏多条缩略图的**请求顺序会二相漂**
 * （L4 请求序基线 08/12 屏实锤）。撤 lazy 后**请求序＝DOM 渲染序（确定）**；
 * 大列表（几百条）的全量图片加载代价由 task.md「C4 规模实测」项评估裁量。
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
      decoding="async"
      onError={() => setFailed(true)}
      className="size-full object-cover"
    />
  );
}
