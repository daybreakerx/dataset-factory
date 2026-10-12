import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { LiveOutput } from "./live-output";

function renderLive(
  stopped: "user" | "network" | null | undefined,
  content = "一位年轻女性站在米白色纱帘前，视线略",
) {
  return render(
    <LiveOutput
      batch="s1"
      batches={[]}
      available={[]}
      compared={[]}
      onToggleCompared={vi.fn()}
      liveOutput={{ item: "first", reasoning: "", content, stopped }}
      unfolded={false}
    />,
  );
}

it("在飞态不挂「已中断」标签、正文取正文色", () => {
  renderLive(null);

  expect(screen.queryByText("已中断")).not.toBeInTheDocument();
  expect(screen.getByText(/纱帘前/)).toHaveClass("text-foreground");
});

it("手动停止＝琥珀标签＋半截正文弱一档（E5 稿矩阵⑨）", () => {
  renderLive("user");

  expect(screen.getByText("已中断")).toHaveClass("text-warn-ink");
  // 半截内容留在原地（只活内存、不落盘），字色弱化到 --text-3。
  expect(screen.getByText(/纱帘前/)).toHaveClass("text-text-3");
});

it("网络异常＝红标签（同一形态、分档由停因定）", () => {
  renderLive("network");

  expect(screen.getByText("已中断")).toHaveClass("text-bad-ink");
});

it("中断且首字未到：等待行与标签同在场", () => {
  renderLive("user", "");

  expect(screen.getByText("正在组装请求…")).toBeInTheDocument();
  expect(screen.getByText("已中断")).toBeInTheDocument();
});
