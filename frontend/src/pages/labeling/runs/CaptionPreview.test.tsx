import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../../../api";
import type { components } from "../../../api-types.gen";
import { CaptionPreview } from "./CaptionPreview";
import { nextCompared } from "./compare-picker";

vi.mock("../../../api", async (original) => {
  const actual = await original<typeof import("../../../api")>();
  return {
    ...actual,
    api: { readCaption: vi.fn() },
  };
});

const row: components["schemas"]["ItemRowView"] = {
  item: "frame",
  name: "frame.jpg",
  status: "done",
  media: "image",
  can_retry: true,
  in_retry: false,
};

const batches: components["schemas"]["BatchView"][] = [1, 2, 3, 4, 5].map((seq) => ({
  id: `s${seq}`,
  seq,
  name: `策略${seq}`,
  active: seq !== 5,
  created_at: "2026-09-17T00:00:00Z",
  description: "",
  product_count: 1,
}));

/** 受控父视图替身：对比名单与替换式上限由 MaterialDetail 持有，这里照搬同一套逻辑。 */
function Harness({
  wid = "work",
  batch = "s1",
  entry = row,
  unfolded = false,
}: {
  wid?: string;
  batch?: string;
  entry?: components["schemas"]["ItemRowView"];
  unfolded?: boolean;
}) {
  const [compared, setCompared] = useState<string[]>([]);
  const available = batches.filter((entry) => entry.active && entry.id !== batch);
  return (
    <CaptionPreview
      wid={wid}
      batch={batch}
      row={entry}
      batches={batches}
      available={available}
      compared={compared.filter((id) => available.some((e) => e.id === id))}
      onToggleCompared={(id) => setCompared((previous) => nextCompared(previous, id))}
      unfolded={unfolded}
    />
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.readCaption).mockResolvedValue("A detailed caption.");
});

describe("产出区·已完成态", () => {
  it("当前策略固定第一栏，到顶不置灰而是踢最早加入的那套", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByRole("button", { name: "策略1 · s1" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "策略5 · s5" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "策略1 · s1" }));
    expect(screen.getAllByRole("region", { name: /^产物 / })).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "策略3 · s3" }));
    await user.click(screen.getByRole("button", { name: "策略2 · s2" }));

    expect(
      screen
        .getAllByRole("region", { name: /^产物 / })
        .map((entry) => entry.getAttribute("aria-label")),
    ).toEqual(["产物 s1", "产物 s3", "产物 s2"]);
    // 第三套加入＝上限已满：不置灰、点它生效，被踢的是最早加入的 s3。
    await user.click(screen.getByRole("button", { name: "策略4 · s4" }));
    expect(
      screen
        .getAllByRole("region", { name: /^产物 / })
        .map((entry) => entry.getAttribute("aria-label")),
    ).toEqual(["产物 s1", "产物 s2", "产物 s4"]);
    expect(screen.queryByRole("region", { name: "产物 s3" })).not.toBeInTheDocument();
  });

  it("各对比栏读取独立批次并分别展示无产出和读取错误", async () => {
    const user = userEvent.setup();
    vi.mocked(api.readCaption).mockImplementation(async (_wid, batch) => {
      if (batch === "s2") throw new ApiError("http", "没有产物", 404, null);
      if (batch === "s3") throw new Error("读取失败");
      return "Current caption";
    });
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "策略2 · s2" }));
    await user.click(screen.getByRole("button", { name: "策略3 · s3" }));

    expect(
      within(screen.getByRole("region", { name: "产物 s1" })).getByText(
        "Current caption",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "产物 s2" })).getByText("暂无产出"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "产物 s3" })).getByRole("alert"),
    ).toHaveTextContent("读取失败");
    expect(api.readCaption).toHaveBeenCalledWith("work", "s2", "frame");
    expect(api.readCaption).toHaveBeenCalledWith("work", "s3", "frame");
  });

  it("取数中与无产物分两句，取数中不谎报成没有产出", async () => {
    let finish: ((value: string) => void) | undefined;
    vi.mocked(api.readCaption).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<Harness />);

    const box = screen.getByRole("region", { name: "产物 s1" });
    expect(box).toHaveTextContent("正在读取…");
    expect(box).not.toHaveTextContent("暂无产出");
    expect(box).toHaveAttribute("aria-busy", "true");
    await act(async () => {
      finish?.("");
    });

    expect(await screen.findByText("暂无产出")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "产物 s1" })).toHaveAttribute(
      "aria-busy",
      "false",
    );
  });

  it("本件不再提供名单编辑动作（加入重试归左列条目行）", async () => {
    render(<Harness />);

    await screen.findByText("A detailed caption.");
    expect(
      screen.queryByRole("button", { name: /加入重试|移出重试|正在保存/ }),
    ).not.toBeInTheDocument();
  });

  it("同一素材状态更新后重新读取产物并保留对比选择", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness />);
    await user.click(screen.getByRole("button", { name: "策略2 · s2" }));
    vi.mocked(api.readCaption).mockResolvedValue("Updated caption");

    rerender(<Harness entry={{ ...row }} />);

    expect(await screen.findByText("Updated caption")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "产物 s2" })).toBeInTheDocument();
  });

  it("切换素材后迟到的旧 caption 不覆盖新素材", async () => {
    let finish: ((caption: string) => void) | undefined;
    vi.mocked(api.readCaption).mockImplementation((_wid, _batch, item) =>
      item === "frame"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve("New caption"),
    );
    const { rerender } = render(<Harness />);

    rerender(<Harness entry={{ ...row, item: "new" }} />);
    await screen.findByText("New caption");
    await act(async () => {
      finish?.("Old caption");
    });

    expect(screen.queryByText("Old caption")).not.toBeInTheDocument();
    expect(screen.getByText("New caption")).toBeInTheDocument();
  });

  it("舞台展开态给正文锁 180 上限并内滚", () => {
    render(<Harness />);

    expect(screen.getByRole("region", { name: "产物 s1" })).toHaveClass(
      "max-h-[180px]",
      "overflow-y-auto",
    );
  });

  it("舞台折叠态解除正文上限（产出吃满剩余空间）", () => {
    render(<Harness unfolded />);

    expect(screen.getByRole("region", { name: "产物 s1" })).not.toHaveClass(
      "max-h-[180px]",
    );
  });
});
