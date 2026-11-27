import { describe, expect, it } from "vitest";
import { orderMessages, resolveMessageOrder } from "./messagesOrder";

const messages = [{ sequence: 3 }, { sequence: 1 }, { sequence: 2 }];

describe("resolveMessageOrder", () => {
  it("地址栏写了就听地址栏", () => {
    expect(resolveMessageOrder("desc", "asc")).toBe("desc");
    expect(resolveMessageOrder("asc", "desc")).toBe("asc");
  });

  it("地址栏没写就听本机记住的那个", () => {
    expect(resolveMessageOrder(null, "desc")).toBe("desc");
    expect(resolveMessageOrder(undefined, "asc")).toBe("asc");
  });

  it("认不出的值不抹掉记住的选择", () => {
    expect(resolveMessageOrder("随便写点", "desc")).toBe("desc");
  });
});

describe("orderMessages", () => {
  it("正序：旧的在上面", () => {
    expect(orderMessages(messages, "asc").map((row) => row.sequence)).toEqual([1, 2, 3]);
  });

  it("倒序：最新的在上面", () => {
    expect(orderMessages(messages, "desc").map((row) => row.sequence)).toEqual([3, 2, 1]);
  });

  it("不改调用方那份", () => {
    const input = [...messages];
    orderMessages(input, "desc");
    expect(input.map((row) => row.sequence)).toEqual([3, 1, 2]);
  });
});
