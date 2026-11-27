import { describe, expect, it } from "vitest";
import { orderMessages, parseMessageOrder } from "./messagesOrder";

const messages = [{ sequence: 3 }, { sequence: 1 }, { sequence: 2 }];

describe("parseMessageOrder", () => {
  it("只认 desc，其余都是正序", () => {
    expect(parseMessageOrder("desc")).toBe("desc");
    expect(parseMessageOrder("asc")).toBe("asc");
    expect(parseMessageOrder(null)).toBe("asc");
    expect(parseMessageOrder("随便写点")).toBe("asc");
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
