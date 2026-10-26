import { describe, expect, it } from "vitest";
import {
  assertEdgeShape,
  buildEdgeIndex,
  openNeighborIds,
  sealedNeighborIds,
} from "../src/game/edges";

const edges = [
  { fromStageId: "a", toStageId: "b", passage: "open" as const },
  { fromStageId: "b", toStageId: "a", passage: "open" as const },
  { fromStageId: "a", toStageId: "c", passage: "sealed" as const },
];

describe("stage edges", () => {
  it("indexes directed edges without inferring the reverse", () => {
    const index = buildEdgeIndex(edges);
    expect(openNeighborIds(index, "a")).toEqual(["b"]);
    expect(openNeighborIds(index, "c")).toEqual([]);
    expect(sealedNeighborIds(index, "a")).toEqual(["c"]);
    expect(sealedNeighborIds(index, "b")).toEqual([]);
    expect(index.outgoing("missing")).toEqual([]);
  });

  it("requires both directions to be declared for bidirectional passage", () => {
    const index = buildEdgeIndex([{ fromStageId: "a", toStageId: "b", passage: "open" }]);
    expect(openNeighborIds(index, "a")).toEqual(["b"]);
    expect(openNeighborIds(index, "b")).toEqual([]);
  });

  it("rejects self connections", () => {
    expect(() => assertEdgeShape("a", "a")).toThrow(/自身/);
    expect(() => assertEdgeShape("a", "b")).not.toThrow();
  });
});
