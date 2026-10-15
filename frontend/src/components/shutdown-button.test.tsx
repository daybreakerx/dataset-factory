import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../api";
import { ShutdownButton } from "./shutdown-button";
import { TooltipProvider } from "./ui/tooltip";

vi.mock("../api", async (original) => ({
  ...(await original<typeof import("../api")>()),
  api: { getServiceBusy: vi.fn(), shutdownService: vi.fn() },
}));

/** 关机确认弹窗的正文口径：基句整句撤除后，只在
 *  「关了会丢东西」时出话——设置页有未保存修改，或后端 `/api/service/busy` 报有在飞的跑批／任务。 */
function renderButton(dirty = false): void {
  render(
    <TooltipProvider>
      <ShutdownButton dirty={dirty} />
    </TooltipProvider>,
  );
}

async function openDialog(
  user: ReturnType<typeof userEvent.setup>,
): Promise<HTMLElement> {
  await user.click(screen.getByRole("button", { name: "关闭服务" }));
  return screen.findByRole("dialog", { name: "关闭服务？" });
}

describe("关闭服务按钮", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(api.getServiceBusy).mockResolvedValue({ runs: 0, tasks: 0 });
    vi.mocked(api.shutdownService).mockResolvedValue(undefined);
  });

  it("开窗查一次 busy：任一在飞即出警告行", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getServiceBusy).mockResolvedValue({ runs: 1, tasks: 2 });
    renderButton();

    const dialog = await openDialog(user);

    expect(api.getServiceBusy).toHaveBeenCalledOnce();
    expect(
      within(dialog).getByText("当前有正在进行中的任务，关闭会丢失未完成的部分。"),
    ).toBeInTheDocument();
  });

  it("全空时不出警告行、正文也不留基句（描述槽为空）", async () => {
    const user = userEvent.setup();
    renderButton();

    const dialog = await openDialog(user);

    expect(within(dialog).queryByText(/关闭前会等/)).not.toBeInTheDocument();
    expect(
      within(dialog).queryByText("当前有正在进行中的任务，关闭会丢失未完成的部分。"),
    ).not.toBeInTheDocument();
  });

  it("设置页有未保存修改时出 dirty 警告行，与任务警告行各占一行", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getServiceBusy).mockResolvedValue({ runs: 0, tasks: 1 });
    renderButton(true);

    const dialog = await openDialog(user);

    expect(
      within(dialog).getByText("有未保存的修改，关闭后将丢失。"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("当前有正在进行中的任务，关闭会丢失未完成的部分。"),
    ).toBeInTheDocument();
  });

  it("busy 取数失败不拦关机：弹窗照常开、宁可不提醒也不拿猜测拦人", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getServiceBusy).mockRejectedValue(
      new ApiError("http", "none", 500, null),
    );
    renderButton();

    const dialog = await openDialog(user);

    expect(
      within(dialog).queryByText("当前有正在进行中的任务，关闭会丢失未完成的部分。"),
    ).not.toBeInTheDocument();
  });

  it("确认关机：受理后广播 df:service-stopping 供状态点转「正在停止」", async () => {
    const user = userEvent.setup();
    const stopping = vi.fn();
    window.addEventListener("df:service-stopping", stopping);
    renderButton();
    const dialog = await openDialog(user);

    await user.click(within(dialog).getByRole("button", { name: "关闭服务" }));

    await waitFor(() => expect(api.shutdownService).toHaveBeenCalledOnce());
    expect(stopping).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    window.removeEventListener("df:service-stopping", stopping);
  });
});
