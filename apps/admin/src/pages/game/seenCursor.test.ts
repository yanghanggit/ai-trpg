import { describe, expect, it } from "vitest";
import { unseenCount } from "./seenCursor";

describe("unseenCount", () => {
  it("水位之后的条数 = 最大序号 - 水位", () => {
    expect(unseenCount(13, 10)).toBe(3);
  });

  it("看过了就是 0，不会是负数", () => {
    expect(unseenCount(13, 13)).toBe(0);
    expect(unseenCount(13, 20)).toBe(0);
  });

  it("没有水位（第一次）或读不到位置时算 0", () => {
    expect(unseenCount(13, undefined)).toBe(0);
    expect(unseenCount(undefined, 3)).toBe(0);
  });
});
