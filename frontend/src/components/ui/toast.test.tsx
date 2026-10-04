import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "../../lib/toast";
import { ToastViewport } from "./toast";

/**
 * 浮层提示的渲染与消失（形态：黑底白字、居中贴底、驻留 5 秒淡入淡出、纯展示不可点）。
 *
 * 计时器全程造假：驻留 5 秒用真时间等等于每个用例白等；jsdom 不跑 CSS 过渡，
 * 出场摘除走兜底时限或手工派发 transitionEnd 验证两条路。
 */
describe("ToastViewport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.advanceTimersByTime(6_000);
    vi.useRealTimers();
  });

  it("投递后进入状态区域，驻留 5 秒后转入淡出，过渡走完才摘除", () => {
    render(<ToastViewport />);
    act(() => toast("服务可能已关闭"));

    expect(screen.getByText("服务可能已关闭")).toBeVisible();

    act(() => vi.advanceTimersByTime(4_999));
    expect(screen.getByText("服务可能已关闭")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    const leaving = screen.getByText("服务可能已关闭");
    expect(leaving).toHaveAttribute("data-leaving");

    fireEvent.transitionEnd(leaving, { propertyName: "opacity" });
    expect(screen.queryByText("服务可能已关闭")).not.toBeInTheDocument();
  });

  it("过渡结束事件不来时按兜底时限摘除", () => {
    render(<ToastViewport />);
    act(() => toast("服务可能已关闭"));

    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByText("服务可能已关闭")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(250));
    expect(screen.queryByText("服务可能已关闭")).not.toBeInTheDocument();
  });

  it("条是纯展示：点击不可摘除，多条互不影响", () => {
    render(<ToastViewport />);
    act(() => {
      toast("服务可能已关闭");
      toast("另一条");
    });

    fireEvent.click(screen.getByText("服务可能已关闭"));

    expect(screen.getByText("服务可能已关闭")).toBeInTheDocument();
    expect(screen.getByText("另一条")).toBeInTheDocument();
  });

  it("悬停暂停所在条的驻留计时，移开后续算剩余时间而不是重新计满", () => {
    render(<ToastViewport />);
    act(() => toast("服务可能已关闭"));
    const bar = screen.getByText("服务可能已关闭");

    fireEvent.mouseEnter(bar);
    act(() => vi.advanceTimersByTime(6_000));
    expect(screen.getByText("服务可能已关闭")).toBeInTheDocument();

    fireEvent.mouseLeave(bar);
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByText("服务可能已关闭")).toHaveAttribute("data-leaving");

    fireEvent.transitionEnd(screen.getByText("服务可能已关闭"), {
      propertyName: "opacity",
    });
    expect(screen.queryByText("服务可能已关闭")).not.toBeInTheDocument();
  });
});
