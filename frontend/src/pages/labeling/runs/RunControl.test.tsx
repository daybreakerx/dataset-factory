import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../../../api";
import { RunControl } from "./RunControl";

vi.mock("../../../api", async (original) => ({
  ...(await original<typeof import("../../../api")>()),
  api: { currentRun: vi.fn(), startRun: vi.fn(), stopRun: vi.fn(), listItems: vi.fn() },
}));

class FakeEventSource {
  static last: FakeEventSource | undefined;
  listeners = new Map<string, (event: MessageEvent) => void>();
  onerror: (() => void) | null = null;
  onopen: (() => void | Promise<void>) | null = null;
  constructor(public url: string) {
    FakeEventSource.last = this;
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.listeners.set(type, listener);
  }
  close(): void {}
  emit(type: string, data: unknown): void {
    this.listeners.get(type)?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}
vi.stubGlobal("EventSource", FakeEventSource);

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.currentRun)
    .mockRejectedValueOnce(new ApiError("http", "none", 404, null))
    .mockResolvedValue({
      run_id: "run",
      status: "running",
      batch: 1,
      mode: "full",
      counters: {},
      current_item: null,
      error: null,
    });
  vi.mocked(api.startRun).mockResolvedValue({ run_id: "run" });
  vi.mocked(api.listItems).mockResolvedValue({ batch: 1, query: "", groups: {} });
});

describe("运行控制", () => {
  it("计数查询未返回时合并事件，结束后迟到快照不恢复运行态", async () => {
    const view = {
      run_id: "run",
      status: "running",
      batch: 1,
      mode: "full",
      counters: { planned: 10, attempted: 3, failed: 1 },
      current_item: "frame",
      error: null,
    };
    let resolveProgress: ((value: typeof view) => void) | undefined;
    vi.mocked(api.currentRun)
      .mockReset()
      .mockResolvedValueOnce(view)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveProgress = resolve;
          }),
      )
      .mockResolvedValue({
        ...view,
        counters: { planned: 10, attempted: 5, failed: 1 },
      });
    render(<RunControl wid="work" batch="s1" onFinish={vi.fn()} />);
    await screen.findByText("3 / 10 · 失败 1");

    act(() => {
      FakeEventSource.last?.emit("run-started", {});
      FakeEventSource.last?.emit("run-started", {});
    });
    expect(api.currentRun).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolveProgress?.(view);
    });
    expect(api.currentRun).toHaveBeenCalledTimes(3);
    expect(screen.getByText("5 / 10 · 失败 1")).toBeInTheDocument();

    vi.mocked(api.currentRun).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveProgress = resolve;
        }),
    );
    act(() => {
      FakeEventSource.last?.emit("run-started", {});
      FakeEventSource.last?.emit("run-finished", {
        run_id: "run",
        batch: 1,
        status: "completed",
      });
    });
    await act(async () => {
      resolveProgress?.(view);
    });
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始打标" })).toBeEnabled();
  });

  it("显示当前运行计数并在条目完成后校准进度", async () => {
    const view = {
      run_id: "run",
      status: "running",
      batch: 1,
      mode: "full",
      counters: { planned: 10, attempted: 3, succeeded: 2, failed: 1 },
      current_item: "frame",
      error: null,
    };
    vi.mocked(api.currentRun).mockReset().mockResolvedValue(view);
    render(<RunControl wid="work" batch="s1" onFinish={vi.fn()} />);
    expect(await screen.findByText("3 / 10 · 失败 1")).toBeInTheDocument();

    vi.mocked(api.currentRun).mockResolvedValue({
      ...view,
      counters: { planned: 10, attempted: 4, succeeded: 3, failed: 1 },
    });
    await act(async () => {
      FakeEventSource.last?.emit("item-updated", {
        batch: 1,
        item: "frame",
        status: "succeeded",
        attempt: 1,
        can_retry: true,
        reason_code: null,
        message: null,
      });
    });

    expect(await screen.findByText("4 / 10 · 失败 1")).toBeInTheDocument();
    // 进度环已撤（对齐批④）：进度只由文本与选择器 chip 内的状态图标表达
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("待启动不算结束，失败帧保留原因", async () => {
    vi.mocked(api.currentRun).mockReset().mockResolvedValue({
      run_id: "run",
      status: "pending",
      batch: 1,
      mode: "full",
      counters: {},
      current_item: null,
      error: null,
    });
    const onFinish = vi.fn();
    render(<RunControl wid="work" batch="s1" onFinish={onFinish} />);
    expect(await screen.findByRole("button", { name: "停止" })).toBeInTheDocument();
    expect(onFinish).not.toHaveBeenCalled();

    act(() =>
      FakeEventSource.last?.emit("run-finished", {
        run_id: "run",
        batch: 1,
        status: "failed",
        error: "工作目录正在维护",
      }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent("工作目录正在维护");
    expect(onFinish).toHaveBeenCalledOnce();
  });

  it("空闲页面发现外部启动的运行且不会反复通知结束", async () => {
    vi.useFakeTimers();
    const onFinish = vi.fn();
    render(<RunControl wid="work" batch="s1" onFinish={onFinish} />);

    // L3：空闲慢轮从 5 秒放宽到 15 秒（发现 CLI 外部运行是它唯一的职责）。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });

    expect(screen.getByRole("button", { name: "停止" })).toBeInTheDocument();
    expect(onFinish).not.toHaveBeenCalled();
    act(() =>
      FakeEventSource.last?.emit("run-finished", {
        run_id: "run",
        batch: 1,
        status: "completed",
      }),
    );
    vi.mocked(api.currentRun).mockRejectedValue(
      new ApiError("http", "none", 404, null),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(onFinish).toHaveBeenCalledOnce();
  });

  it("外部运行没有 SSE 时以 current 轮询刷新素材", async () => {
    vi.useFakeTimers();
    vi.mocked(api.currentRun).mockReset().mockResolvedValue({
      run_id: "cli",
      status: "running",
      batch: 1,
      mode: "full",
      counters: {},
      current_item: "image",
      error: null,
    });
    const onFinish = vi.fn();
    render(<RunControl wid="work" batch="s1" onFinish={onFinish} />);
    await act(async () => {});

    act(() => FakeEventSource.last?.onerror?.());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    // B9 契约：全量刷新挂在「SSE 建连」上、每个运行一次——SSE 断着时重连本身
    // 不再触发全量重扫，建连成功后才刷。
    await act(async () => {
      await FakeEventSource.last?.onopen?.();
    });

    expect(onFinish).toHaveBeenCalledOnce();
    expect(screen.getByText("正在处理：image")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "停止" })).toBeEnabled();
  });

  it("重连全量刷新未完成时暂存增量，刷新后再应用", async () => {
    const user = userEvent.setup();
    let resolveRefresh: (() => void) | undefined;
    const onFinish = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    const onItemUpdate = vi.fn();
    render(
      <RunControl
        wid="work"
        batch="s1"
        onFinish={onFinish}
        onItemUpdate={onItemUpdate}
      />,
    );
    // 等初始探测落定（空闲 → 按钮可用），点击不再赌冲刷时序。
    await act(async () => {});
    await user.click(screen.getByRole("button", { name: "开始打标" }));
    const update = {
      batch: 1,
      item: "frame",
      status: "succeeded",
      attempt: 1,
      can_retry: true,
      reason_code: null,
      message: null,
    };

    act(() => {
      void FakeEventSource.last?.onopen?.();
    });
    act(() => {
      FakeEventSource.last?.emit("item-updated", update);
    });

    expect(onItemUpdate).not.toHaveBeenCalled();
    await act(async () => {
      resolveRefresh?.();
    });
    expect(onItemUpdate).toHaveBeenCalledExactlyOnceWith(update);
  });

  it("断线后旧连接的结束事件不能结束重连中的运行", async () => {
    const user = userEvent.setup();
    const onFinish = vi.fn();
    render(<RunControl wid="work" batch="s1" onFinish={onFinish} />);
    // 等初始探测落定（空闲 → 按钮可用），点击不再赌冲刷时序。
    await act(async () => {});
    await user.click(screen.getByRole("button", { name: "开始打标" }));
    const oldSource = FakeEventSource.last;
    expect(oldSource).toBeDefined();
    vi.useFakeTimers();

    act(() => {
      oldSource?.onerror?.();
      oldSource?.emit("run-finished", { run_id: "run", batch: 1, status: "completed" });
    });

    expect(screen.getByRole("button", { name: "停止" })).toBeInTheDocument();
    expect(onFinish).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    const newSource = FakeEventSource.last;
    expect(newSource).not.toBe(oldSource);
    // B9 契约：全量刷新挂在「SSE 建连」上、每个运行一次。
    await act(async () => {
      await newSource?.onopen?.();
    });
    expect(onFinish).toHaveBeenCalledOnce();
    onFinish.mockClear();
    act(() => {
      oldSource?.emit("run-finished", { run_id: "run", batch: 1, status: "completed" });
      newSource?.emit("run-finished", {
        run_id: "other-run",
        batch: 1,
        status: "completed",
      });
    });
    expect(onFinish).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "停止" })).toBeInTheDocument();
    act(() => {
      newSource?.emit("run-finished", { run_id: "run", batch: 1, status: "completed" });
    });
    expect(onFinish).toHaveBeenCalledExactlyOnceWith();
    expect(screen.getByRole("button", { name: "开始打标" })).toBeEnabled();
  });

  it("点开始打标即起跑批：发车拦截已退役，不再查未导入、不弹确认", async () => {
    const user = userEvent.setup();
    const onFinish = vi.fn();
    vi.mocked(api.listItems).mockResolvedValue({
      batch: 1,
      query: "",
      groups: {
        unimported: [
          {
            item: "bad",
            name: "bad.heic",
            reason: "扩展名不支持",
            status: "unimported",
            media: "file",
            can_retry: false,
            in_retry: false,
          },
        ],
      },
    });
    render(<RunControl wid="work" batch="s1" onFinish={onFinish} />);
    // 等初始探测落定（空闲 → 按钮可用），点击不再赌冲刷时序。
    await act(async () => {});

    await user.click(screen.getByRole("button", { name: "开始打标" }));

    expect(api.startRun).toHaveBeenCalledWith("work", "s1", "full");
    expect(screen.queryByText(/未登记/)).not.toBeInTheDocument();
    expect(screen.getByText("运行中")).toBeInTheDocument();
  });

  it("事件更新当前素材，结束后触发全量刷新", async () => {
    const user = userEvent.setup();
    const onFinish = vi.fn();
    render(<RunControl wid="work" batch="s1" onFinish={onFinish} />);
    // 等初始探测落定（空闲 → 按钮可用），点击不再赌冲刷时序。
    await act(async () => {});

    await user.click(screen.getByRole("button", { name: "开始打标" }));
    act(() => {
      FakeEventSource.last?.emit("item-updated", {
        batch: 1,
        item: "cat_002",
        status: "started",
        attempt: 1,
        can_retry: false,
        reason_code: null,
        message: null,
      });
    });

    expect(screen.getByText("正在处理：cat_002")).toBeInTheDocument();
    act(() => {
      FakeEventSource.last?.emit("run-finished", {
        run_id: "run",
        batch: 1,
        status: "completed",
      });
    });

    expect(onFinish).toHaveBeenCalledExactlyOnceWith();
    expect(screen.getByRole("button", { name: "开始打标" })).toBeEnabled();
  });

  it("运行史五态：中断只出「继续」并按全量续跑、完成整组不渲染、启动失败回「开始打标」", async () => {
    const user = userEvent.setup();
    // 初始探测走 404（空闲），活观测不在场——五态判定全由 runStatus 承担。
    vi.mocked(api.currentRun)
      .mockReset()
      .mockRejectedValue(new ApiError("http", "none", 404, null));
    const { rerender } = render(
      <RunControl wid="work" batch="s1" onFinish={vi.fn()} runStatus="interrupted" />,
    );

    const resume = screen.getByRole("button", { name: "继续" });
    expect(screen.queryByRole("button", { name: "开始打标" })).not.toBeInTheDocument();
    await user.click(resume);
    expect(api.startRun).toHaveBeenCalledWith("work", "s1", "full");

    rerender(
      <RunControl wid="work" batch="s1" onFinish={vi.fn()} runStatus="completed" />,
    );
    expect(screen.queryByRole("button", { name: "继续" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "开始打标" })).not.toBeInTheDocument();

    rerender(
      <RunControl wid="work" batch="s1" onFinish={vi.fn()} runStatus="failed" />,
    );
    expect(screen.getByRole("button", { name: "开始打标" })).toBeInTheDocument();
  });

  it("顶栏不再有「开始重试」钮（动作的家在左列重试列表组头）", async () => {
    render(<RunControl wid="work" batch="s1" onFinish={vi.fn()} />);
    // 初始探测（404 → 空闲）落定后再断言。
    await act(async () => {});

    expect(screen.getByRole("button", { name: "开始打标" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "开始重试" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("启动失败显示错误且不进入运行态", async () => {
    const user = userEvent.setup();
    vi.mocked(api.startRun).mockRejectedValue(new Error("已有跑批在运行"));
    render(<RunControl wid="work" batch="s1" onFinish={vi.fn()} />);
    // 等初始探测落定（空闲 → 按钮可用），再点开始。
    await act(async () => {});
    expect(screen.getByRole("button", { name: "开始打标" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "开始打标" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("已有跑批在运行");
    expect(screen.getByRole("button", { name: "开始打标" })).toBeEnabled();
  });

  it("左列组头的重试令牌变化即按 retry 模式发车，并把状态报给顶栏", async () => {
    const onRunStatus = vi.fn();
    const { rerender } = render(
      <RunControl
        wid="work"
        batch="s1"
        onFinish={vi.fn()}
        onRunStatus={onRunStatus}
        retryRequest={0}
      />,
    );

    expect(api.startRun).not.toHaveBeenCalled();

    rerender(
      <RunControl
        wid="work"
        batch="s1"
        onFinish={vi.fn()}
        onRunStatus={onRunStatus}
        retryRequest={1}
      />,
    );

    await waitFor(() =>
      expect(api.startRun).toHaveBeenCalledWith("work", "s1", "retry"),
    );
    expect(onRunStatus).toHaveBeenCalledWith("running");
  });

  it("停止两档：确认按 graceful 受理并出组内反馈行，等条目窗口可重复唤起改选立即中断", async () => {
    const user = userEvent.setup();
    vi.mocked(api.currentRun)
      .mockReset()
      .mockResolvedValue({
        run_id: "run",
        status: "running",
        batch: 1,
        mode: "full",
        counters: { planned: 10, attempted: 3, failed: 1 },
        current_item: null,
        error: null,
      });
    vi.mocked(api.stopRun).mockResolvedValue(undefined);
    render(<RunControl wid="work" batch="s1" onFinish={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "停止" }));

    expect(await screen.findByRole("dialog", { name: "停止跑批？" })).toHaveTextContent(
      "当前条目正在生成中，是否等待条目完成后中断？",
    );
    await user.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() =>
      expect(api.stopRun).toHaveBeenCalledWith("work", "s1", "graceful"),
    );

    expect(
      await screen.findByText("停止已受理，当前条目完成后停下"),
    ).toBeInTheDocument();
    // ③：等条目窗口里停止钮仍可点，再点重开弹窗可改选「立即中断」（反馈行随档撤下）。
    await user.click(screen.getByRole("button", { name: "停止" }));
    await user.click(await screen.findByRole("button", { name: "立即中断" }));
    await waitFor(() =>
      expect(api.stopRun).toHaveBeenCalledWith("work", "s1", "immediate"),
    );
    expect(
      screen.queryByText("停止已受理，当前条目完成后停下"),
    ).not.toBeInTheDocument();
  });

  it("停止弹窗 Esc 关窗不发停止请求（不停止、照常跑）", async () => {
    const user = userEvent.setup();
    vi.mocked(api.currentRun).mockReset().mockResolvedValue({
      run_id: "run",
      status: "running",
      batch: 1,
      mode: "full",
      counters: {},
      current_item: null,
      error: null,
    });
    vi.mocked(api.stopRun).mockResolvedValue(undefined);
    render(<RunControl wid="work" batch="s1" onFinish={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "停止" }));
    await screen.findByRole("dialog", { name: "停止跑批？" });

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.stopRun).not.toHaveBeenCalled();
  });
});
