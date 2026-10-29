import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BatchSelector, type WorkdirBatches } from "./BatchSelector";

const workdirs: WorkdirBatches[] = [
  {
    id: "first",
    title: "素材一",
    batches: [
      {
        id: "s1",
        seq: 1,
        name: "详细描述",
        description: "",
        active: true,
        benchmark: false,
        created_at: "",
        product_count: 2,
      },
      {
        id: "s2",
        seq: 2,
        name: "隐藏策略",
        description: "",
        active: false,
        benchmark: false,
        created_at: "",
        product_count: 0,
      },
    ],
  },
  {
    id: "second",
    title: "素材二",
    batches: [
      {
        id: "s1",
        seq: 1,
        name: "详细描述",
        description: "",
        active: true,
        benchmark: false,
        created_at: "",
        product_count: 0,
      },
    ],
  },
];

describe("批次选择器", () => {
  it("下拉行内显示最近运行的状态图标、进度与当前行强调", async () => {
    const user = userEvent.setup();
    const withRun: WorkdirBatches[] = [
      {
        id: "first",
        title: "素材一",
        batches: [
          {
            id: "s1",
            seq: 1,
            name: "详细描述",
            description: "",
            active: true,
            benchmark: false,
            created_at: "",
            product_count: 2,
            run_status: "completed",
            run_done: 2,
            run_total: 3,
          },
          {
            id: "s2",
            seq: 2,
            name: "标签式短句",
            description: "",
            active: true,
            benchmark: false,
            created_at: "",
            product_count: 0,
            run_status: null,
            run_done: null,
            run_total: null,
          },
        ],
      },
    ];
    render(
      <BatchSelector
        workdirs={withRun}
        value={{ workdirId: "first", batchId: "s1" }}
        onChange={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "选择工作目录与批次" }));

    expect(screen.getByRole("img", { name: "已完成" })).toBeInTheDocument();
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    const current = screen.getByRole("menuitem", { name: /详细描述/ });
    expect(current).toHaveAttribute("aria-current", "true");
    // 未开始（run_status 为 null）仍出图标、不留空位；无运行记录的批次不带进度计数
    const other = screen.getByRole("menuitem", { name: /标签式短句/ });
    expect(within(other).getByRole("img", { name: "未开始" })).toBeInTheDocument();
    expect(within(other).queryByText(/\/ 3/)).not.toBeInTheDocument();
  });

  it("弹层打开即回调重拉：飞行期整层换「正在读取…」，失败换「工作目录读取失败」", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const { rerender } = render(
      <BatchSelector
        workdirs={workdirs}
        value={null}
        onChange={vi.fn()}
        loading
        onOpen={onOpen}
      />,
    );
    await user.click(screen.getByRole("button", { name: "选择工作目录与批次" }));
    expect(screen.getByText("正在读取…")).toBeInTheDocument();
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
    expect(onOpen).toHaveBeenCalledExactlyOnceWith();

    rerender(
      <BatchSelector
        workdirs={workdirs}
        value={null}
        onChange={vi.fn()}
        loadError="工作目录读取失败"
        onOpen={onOpen}
      />,
    );
    expect(screen.getByText("工作目录读取失败")).toBeInTheDocument();
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });

  it("目录行整行触发折叠、子行随藏；再点展回", async () => {
    const user = userEvent.setup();
    render(<BatchSelector workdirs={workdirs} value={null} onChange={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "选择工作目录与批次" }));

    const group = screen.getByRole("group", { name: "素材一" });
    await user.click(within(group).getByText("素材一"));
    // aria-expanded 在折叠钮上（折叠区＝真 button，行尾两枚动作钮是其兄弟）
    expect(within(group).getByRole("button", { name: "素材一" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(within(group).queryByRole("menuitem")).not.toBeInTheDocument();

    await user.click(within(group).getByText("素材一"));
    expect(within(group).getByRole("menuitem")).toBeInTheDocument();
  });

  it("目录加号传递目录身份且关闭菜单", async () => {
    const user = userEvent.setup();
    const onNewStrategy = vi.fn();
    render(
      <BatchSelector
        workdirs={workdirs}
        value={null}
        onChange={vi.fn()}
        onNewStrategy={onNewStrategy}
      />,
    );
    await user.click(screen.getByRole("button", { name: "选择工作目录与批次" }));
    await user.click(screen.getByRole("button", { name: "新增策略 素材二" }));
    expect(onNewStrategy).toHaveBeenCalledExactlyOnceWith("second");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
  it("按目录分组且不展示停用批次", async () => {
    const user = userEvent.setup();
    render(<BatchSelector workdirs={workdirs} value={null} onChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "选择工作目录与批次" }));

    expect(screen.getByRole("group", { name: "素材一" })).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
    expect(screen.queryByText("隐藏策略")).not.toBeInTheDocument();
  });

  it("同名同序号跨目录切换时返回目录与批次完整身份并关闭菜单", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <BatchSelector
        workdirs={workdirs}
        value={{ workdirId: "first", batchId: "s1" }}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "选择工作目录与批次" }));
    await user.click(
      within(screen.getByRole("group", { name: "素材二" })).getByRole("menuitem"),
    );

    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      workdirId: "second",
      batchId: "s1",
    });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("空目录没有可触发的虚构批次", async () => {
    const user = userEvent.setup();
    render(
      <BatchSelector
        workdirs={[{ id: "empty", title: "空目录", batches: [] }]}
        value={null}
        onChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "选择工作目录与批次" }));

    expect(screen.getByText("还没有可用的批次")).toBeInTheDocument();
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });

  it("触发钮状态位按运行状态显示图标，无记录时显示「未开始」", () => {
    const { rerender } = render(
      <BatchSelector
        workdirs={workdirs}
        value={{ workdirId: "first", batchId: "s1" }}
        onChange={vi.fn()}
        runState="completed"
      />,
    );

    expect(screen.getByRole("img", { name: "已完成" })).toBeInTheDocument();

    rerender(
      <BatchSelector
        workdirs={workdirs}
        value={{ workdirId: "first", batchId: "s1" }}
        onChange={vi.fn()}
        runState="running"
      />,
    );
    expect(screen.getByRole("img", { name: "跑批中" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "已完成" })).not.toBeInTheDocument();

    rerender(
      <BatchSelector
        workdirs={workdirs}
        value={{ workdirId: "first", batchId: "s1" }}
        onChange={vi.fn()}
        runState={null}
      />,
    );
    expect(screen.getByRole("img", { name: "未开始" })).toBeInTheDocument();
  });
});
