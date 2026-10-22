import { describe, expect, it } from "vitest";
import { formatUptime } from "./formatUptime";

describe("formatUptime", () => {
  it("小于一分钟时只显示秒", () => {
    expect(formatUptime(0)).toBe("0 秒");
    expect(formatUptime(42.9)).toBe("42 秒");
  });

  it("小于一小时时显示分与秒", () => {
    expect(formatUptime(65)).toBe("1 分 5 秒");
    expect(formatUptime(3599)).toBe("59 分 59 秒");
  });

  it("超过一小时时显示小时与分", () => {
    expect(formatUptime(3600)).toBe("1 小时 0 分");
    expect(formatUptime(3661)).toBe("1 小时 1 分");
  });

  it("负数按 0 处理", () => {
    expect(formatUptime(-5)).toBe("0 秒");
  });
});
