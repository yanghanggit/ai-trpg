import { describe, expect, it } from "vitest";
import { strictTargetRef } from "./targets";

const names = [
  { name: "掌柜的", token: "#4" },
  { name: "盐贩子", token: "#6" },
];

describe("strictTargetRef", () => {
  it("编号本来就是引用，直接用", () => {
    expect(strictTargetRef({ token: "#2" }, names)).toBe("#2");
  });

  it("认得的名字换成它背后的签名编号：发出去的是身份，不是称呼", () => {
    expect(strictTargetRef({ token: "掌柜的" }, names)).toBe("#4");
  });

  it("只有一个称呼、没有编号可查时不给引用：宁可不让点，也不发昵称", () => {
    expect(strictTargetRef({ token: "披斗篷的" }, names)).toBeUndefined();
  });
});
