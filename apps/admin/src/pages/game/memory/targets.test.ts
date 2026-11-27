import { describe, expect, it } from "vitest";
import { findTarget, KIND_LABEL, type MemoryTarget, matchTargets } from "./targets";

const targets: MemoryTarget[] = [
  { kind: "world", id: "w", name: "枯钟修道院的故事", key: "bell-monastery.v17" },
  { kind: "stage", id: "s1", name: "墓园", key: "graveyard" },
  { kind: "actor", id: "a1", name: "小鼠“坏运气”", key: "mouse" },
  { kind: "actor", id: "a2", name: "奥德里克", key: "odric" },
];

describe("matchTargets", () => {
  it("空输入与单个 @ 都列全部", () => {
    expect(matchTargets(targets, "")).toHaveLength(4);
    expect(matchTargets(targets, "@")).toHaveLength(4);
    expect(matchTargets(targets, "  @  ")).toHaveLength(4);
  });

  it("按名字子串搜，不必先选类型", () => {
    expect(matchTargets(targets, "小鼠").map((t) => t.name)).toEqual(["小鼠“坏运气”"]);
    expect(matchTargets(targets, "园").map((t) => t.kind)).toEqual(["stage"]);
  });

  it("key 与 id 也参与匹配，且不区分大小写", () => {
    expect(matchTargets(targets, "GRAVE").map((t) => t.name)).toEqual(["墓园"]);
    expect(matchTargets(targets, "a2").map((t) => t.name)).toEqual(["奥德里克"]);
  });

  it("@ 后面的词照常当搜索词", () => {
    expect(matchTargets(targets, "@odric").map((t) => t.name)).toEqual(["奥德里克"]);
  });

  it("搜不到就是空清单", () => {
    expect(matchTargets(targets, "神父")).toEqual([]);
  });
});

describe("findTarget", () => {
  it("按 kind + 名字还原；世界不需要名字", () => {
    expect(findTarget(targets, "actor", "奥德里克")?.id).toBe("a2");
    expect(findTarget(targets, "world", null)?.name).toBe("枯钟修道院的故事");
    expect(findTarget(targets, "world", "随便")?.id).toBe("w");
  });

  it("类型对不上或名字不认得就当作没选", () => {
    expect(findTarget(targets, "stage", "奥德里克")).toBeUndefined();
    expect(findTarget(targets, null, "奥德里克")).toBeUndefined();
  });
});

describe("KIND_LABEL", () => {
  it("三类都有中文名", () => {
    expect(KIND_LABEL).toEqual({ world: "世界", stage: "舞台", actor: "角色" });
  });
});
