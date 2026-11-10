import { describe, expect, it } from "vitest";
import { findRoute, type RouteWorld } from "../src/game/route";

/** 用 id + 序号搭一张窄图；这里只测选路，名字与到访都不参与。 */
function routeWorld(
  nodes: [id: string, ordinal: number][],
  edges: [from: string, to: string, passage: "open" | "sealed"][],
): RouteWorld {
  return {
    stages: nodes.map(([id, ordinal]) => ({ id, seq: ordinal + 1, name: id, ordinal })),
    connections: edges.map(([fromStageId, toStageId, passage]) => ({
      fromStageId,
      toStageId,
      passage,
    })),
    visited: new Set<string>(),
  };
}

describe("findRoute", () => {
  it("returns the open chain when a route exists", () => {
    const world = routeWorld(
      [
        ["a", 0],
        ["b", 1],
        ["c", 2],
      ],
      [
        ["a", "b", "open"],
        ["b", "c", "open"],
      ],
    );
    expect(findRoute(world, { fromStageId: "a", toStageId: "c" })).toEqual({
      kind: "path",
      path: ["a", "b", "c"],
    });
  });

  it("says the observer is already there", () => {
    const world = routeWorld([["a", 0]], []);
    expect(findRoute(world, { fromStageId: "a", toStageId: "a" })).toEqual({ kind: "here" });
  });

  it("reports every sealed break that both sides can reach, nearest first", () => {
    const world = routeWorld(
      [
        ["a", 0],
        ["b", 1],
        ["b2", 2],
        ["c", 3],
        ["d", 4],
        ["d2", 5],
      ],
      [
        ["a", "b", "open"],
        ["b", "b2", "sealed"],
        ["b2", "c", "open"],
        ["a", "d", "open"],
        ["d", "d2", "sealed"],
        ["d2", "c", "open"],
      ],
    );
    expect(findRoute(world, { fromStageId: "a", toStageId: "c" })).toEqual({
      kind: "sealed",
      chains: [
        { before: ["a", "b"], after: ["b2", "c"], complete: true },
        { before: ["a", "d"], after: ["d2", "c"], complete: true },
      ],
    });
  });

  it("stops at the first sealed door when nothing behind it leads to the target", () => {
    const world = routeWorld(
      [
        ["a", 0],
        ["b", 1],
        ["z", 2],
        ["c", 3],
      ],
      [
        ["a", "b", "open"],
        ["b", "z", "sealed"],
      ],
    );
    expect(findRoute(world, { fromStageId: "a", toStageId: "c" })).toEqual({
      kind: "sealed",
      chains: [{ before: ["a", "b"], after: ["z"], complete: false }],
    });
  });

  it("says there is no road when no sealed door lies on the way", () => {
    const world = routeWorld(
      [
        ["a", 0],
        ["b", 1],
      ],
      [],
    );
    expect(findRoute(world, { fromStageId: "a", toStageId: "b" })).toEqual({
      kind: "unreachable",
    });
  });
});
