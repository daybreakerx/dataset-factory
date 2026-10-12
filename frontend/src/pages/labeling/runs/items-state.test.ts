/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  groupedItems,
  type ItemRow,
  itemKey,
  itemsFromGroups,
  withInflightOverride,
  withItemUpdate,
  withRetryItems,
} from "./items-state";

const first: ItemRow = {
  item: "first",
  name: "first.jpg",
  media: "image",
  status: "done",
  can_retry: true,
  in_retry: false,
};
const second: ItemRow = { ...first, item: "second", name: "second.jpg" };

describe("素材 Map", () => {
  it("未导入同主干文件不覆盖在册素材，也不继承其重试标记", () => {
    const unsupported: ItemRow = {
      ...first,
      name: "first.psd",
      status: "unimported",
      can_retry: false,
    };
    const alternate: ItemRow = { ...unsupported, name: "first.tiff" };

    const items = withRetryItems(
      itemsFromGroups({ done: [first], unimported: [unsupported, alternate] }),
      ["first"],
    );

    expect(items.size).toBe(3);
    expect(items.get("first")?.status).toBe("done");
    expect(items.get(itemKey(unsupported))).toBe(unsupported);
    expect(groupedItems(items, "").unimported).toHaveLength(2);
    expect(groupedItems(items, "").retry).toHaveLength(1);
  });
  it("运行增量只替换目标行并使分组计数同步变化", () => {
    const items = itemsFromGroups({ done: [first, second] });
    const next = withItemUpdate(items, {
      batch: 1,
      item: "first",
      status: "failed",
      attempt: 4,
      can_retry: true,
      reason_code: "timeout",
      message: "超时",
    });

    expect(next.get("second")).toBe(second);
    expect(groupedItems(next, "").failed).toHaveLength(1);
    expect(groupedItems(next, "").done).toHaveLength(1);
    expect(next.get("first")?.can_retry).toBe(true);
    expect(items.get("first")?.status).toBe("done");
  });

  it("可重试与否取服务端结论，不在前端重判原因码", () => {
    const items = itemsFromGroups({ failed: [{ ...first, status: "failed" }] });

    const next = withItemUpdate(items, {
      batch: 1,
      item: "first",
      status: "failed",
      attempt: 1,
      can_retry: true,
      reason_code: "brand-new-code",
      message: "后端新加的可重试原因码",
    });

    expect(next.get("first")?.can_retry).toBe(true);
  });

  it("普通分组与重试列表共享唯一条目，移出不丢失完成状态", () => {
    const items = itemsFromGroups({ done: [first, second], retry: [first] });

    const groups = groupedItems(items, "first");

    expect(items.size).toBe(2);
    expect(groups.done?.[0]).toBe(groups.retry?.[0]);
    expect(groupedItems(withRetryItems(items, []), "").retry).toEqual([]);
    expect(items.get("first")?.status).toBe("done");
  });

  it("改变一个重试标记只替换该行对象", () => {
    const items = itemsFromGroups({ done: [first, second] });

    const next = withRetryItems(items, ["first"]);

    expect(next.get("second")).toBe(items.get("second"));
    expect(next.get("first")).not.toBe(items.get("first"));
    expect(items.get("first")?.in_retry).toBe(false);
  });

  it("发车覆盖：在飞的失败行视图层转排队中、原分组计数减一（T14）", () => {
    const failedRow: ItemRow = {
      ...first,
      status: "failed",
      can_retry: true,
      reason_code: "timeout",
      message: "端点超时",
    };
    const items = itemsFromGroups({ failed: [failedRow], done: [second] });

    const next = withInflightOverride(items, new Set(["first", "second"]));

    const groups = groupedItems(next, "");
    expect(groups.queued?.map((row) => row.item)).toEqual(["first"]);
    expect(groups.failed).toEqual([]);
    // 「不带原失败原因」：失败行原因撤下；done 行不占位、不在场行不发明。
    expect(next.get("first")?.message).toBeNull();
    expect(next.get("first")?.reason_code).toBeNull();
    expect(next.get("second")?.status).toBe("done");
    expect(next.get("second")).toBe(items.get("second"));
  });

  it("发车覆盖：名单空即原样返回、重试名单身份保留（T14）", () => {
    const items = itemsFromGroups({ done: [first] });

    expect(withInflightOverride(items, new Set())).toBe(items);

    const retryFailed = withRetryItems(
      itemsFromGroups({ failed: [{ ...first, status: "failed" }] }),
      ["first"],
    );
    const next = withInflightOverride(retryFailed, new Set(["first"]));
    expect(next.get("first")?.status).toBe("queued");
    // in_retry 是名单身份、不是显示分组问题：覆盖只动 status 与原因。
    expect(next.get("first")?.in_retry).toBe(true);
  });
});
