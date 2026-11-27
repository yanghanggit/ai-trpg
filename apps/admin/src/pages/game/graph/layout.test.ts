import { describe, expect, it } from "vitest";
import { ACTOR_NODE, layoutStageActors, layoutStages, STAGE_NODE } from "./layout";

describe("layoutStages", () => {
  it("每个舞台都有坐标，缺一不可", () => {
    const positions = layoutStages(
      ["a", "b", "c"],
      [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    );
    expect([...positions.keys()].sort()).toEqual(["a", "b", "c"]);
  });

  it("同一份拓扑算出同一张图：自动刷新不能让节点乱跳", () => {
    const ids = ["a", "b", "c", "d"];
    const edges = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "c", to: "a" },
      { from: "a", to: "d" },
    ];
    expect(layoutStages(ids, edges)).toEqual(layoutStages(ids, edges));
  });

  it("成环与重复边都不炸；点到不存在的舞台的边直接忽略", () => {
    const positions = layoutStages(
      ["a", "b"],
      [
        { from: "a", to: "b" },
        { from: "b", to: "a" },
        { from: "a", to: "b" },
        { from: "a", to: "ghost" },
        { from: "a", to: "a" },
      ],
    );
    expect(positions.size).toBe(2);
  });

  it("坐标是左上角：右边邻居的 x 比左边大", () => {
    const positions = layoutStages(["a", "b"], [{ from: "a", to: "b" }]);
    const left = positions.get("a");
    const right = positions.get("b");
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    if (left === undefined || right === undefined) {
      return;
    }
    expect(right.x).toBeGreaterThan(left.x);
    expect(right.x - left.x).toBeGreaterThanOrEqual(STAGE_NODE.width);
  });
});

describe("layoutStageActors", () => {
  it("一列以内的人排在同一列的相邻行", () => {
    const positions = layoutStageActors(["a", "b", "c"]);
    const first = positions.get("a");
    const second = positions.get("b");
    const third = positions.get("c");
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(third).toBeDefined();
    if (first === undefined || second === undefined || third === undefined) {
      return;
    }
    expect(second.x).toBe(first.x);
    expect(third.x).toBe(first.x);
    expect(second.y - first.y).toBe(ACTOR_NODE.height + 22);
    // 都在根下面，不与根重叠。
    expect(first.y).toBeGreaterThan(STAGE_NODE.height);
  });

  it("超过一列就换列，名次顺序沿列向下、列间向右", () => {
    const ids = ["1", "2", "3", "4", "5"];
    const positions = layoutStageActors(ids, { perColumn: 2 });
    const third = positions.get("3");
    const fifth = positions.get("5");
    const first = positions.get("1");
    expect(first).toBeDefined();
    expect(third).toBeDefined();
    expect(fifth).toBeDefined();
    if (first === undefined || third === undefined || fifth === undefined) {
      return;
    }
    // 第 3 个是第二列第一行：与第 1 个同高、更靠右。
    expect(third.y).toBe(first.y);
    expect(third.x).toBeGreaterThan(first.x);
    // 第 5 个是第三列第一行。
    expect(fifth.x).toBeGreaterThan(third.x);
  });

  it("空名单给出空坐标表，不报错", () => {
    expect(layoutStageActors([]).size).toBe(0);
  });
});
