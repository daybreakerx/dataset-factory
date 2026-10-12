import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ItemRow } from "../runs/items-state";
import { MaterialRow } from "./material-row";

function row(overrides: Partial<ItemRow>): ItemRow {
  return {
    item: "cat_001",
    name: "cat_001.jpg",
    status: "done",
    media: "image",
    in_retry: false,
    can_retry: true,
    ...overrides,
  } as ItemRow;
}

function renderRow(overrides: Partial<ItemRow>, assetUrl: string | null = null) {
  const onSelect = vi.fn();
  render(
    <MaterialRow
      row={row(overrides)}
      selected={false}
      onSelect={onSelect}
      selectionMode={false}
      checked={false}
      onCheck={vi.fn()}
      retryGroup={false}
      saving={false}
      onRemoveRetry={vi.fn()}
      onRecover={vi.fn()}
      onRepoint={vi.fn()}
      onRemoveUnimported={vi.fn()}
      assetUrl={assetUrl}
    />,
  );
  return { onSelect };
}

describe("MaterialRow 缩略图（稿 §34 .row-thumb--media，2026-10-13 E1）", () => {
  it("图片行给真缩略图：img 走 asset 端点、lazy＋异步解码、无 alt（名字在邻文本）", () => {
    renderRow({ media: "image" }, "/api/workdirs/w1/items/cat_001/asset");

    // alt="" 的 img 不进可及性树，按元素取（断言属性而非角色）
    const image = document.querySelector("img");
    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")).toBe("/api/workdirs/w1/items/cat_001/asset");
    expect(image?.getAttribute("loading")).toBe("lazy");
    expect(image?.getAttribute("decoding")).toBe("async");
    expect(image?.getAttribute("alt")).toBe("");
  });

  it("视频行取首帧：#t=0.1 媒体片段＋metadata 预载，并带播放角标", () => {
    renderRow(
      { media: "video", name: "clip_004.mp4" },
      "/api/workdirs/w1/items/clip_004/asset",
    );

    const video = document.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.getAttribute("src")).toBe(
      "/api/workdirs/w1/items/clip_004/asset#t=0.1",
    );
    expect(video?.getAttribute("preload")).toBe("metadata");
    // 播放角标（§34 .lb-itplay）：行内小图标档 14×14 容器
    const badge = document.querySelector("span.bg-black\\/58");
    expect(badge).not.toBeNull();
  });

  it("非媒体行不发缩略图请求：类型图标占位（assetUrl 传 null）", () => {
    renderRow({ media: "file", name: "note_002.txt" }, null);

    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("video")).toBeNull();
    expect(screen.getByText("note_002.txt")).toBeInTheDocument();
  });

  it("缩略图加载失败落回类型图标（素材不在盘上／解不了）", () => {
    renderRow({ media: "image" }, "/api/workdirs/w1/items/cat_001/asset");

    fireEvent.error(document.querySelector("img") as HTMLImageElement);
    expect(document.querySelector("img")).toBeNull();
    // 回退＝图片类型图标（lucide svg，类名带 size 档）
    expect(document.querySelector("svg.size-\\(--icon-sm\\)")).not.toBeNull();
  });
});
