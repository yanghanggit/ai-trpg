import { describe, expect, it } from "vitest";
import type { GameGraph } from "../../../features/games/useGameGraph";
import { entityIndex, nextStageId, queueRows, stagePeople, stageView } from "./viewModel";

function stage(id: string, ordinal: number, extra: Partial<GameGraph["stages"][number]> = {}) {
  return {
    id,
    seq: ordinal + 1,
    key: id,
    name: id,
    ordinal,
    environment: "",
    teleportBlocked: false,
    actions: [],
    anchors: [],
    ...extra,
  };
}

function actor(
  id: string,
  stageId: string,
  seq: number,
  extra: Partial<GameGraph["actors"][number]> = {},
) {
  return {
    id,
    seq,
    key: id,
    name: id,
    stageId,
    hp: 3,
    maxHp: 3,
    stats: {},
    concealed: false,
    isDefaultPlayer: false,
    appearance: {},
    signature: { id: `sig-${id}`, seq: 1, form: "人类" },
    equipment: {},
    items: [],
    statusEffects: [],
    knowledgeAccess: [],
    actions: [],
    ...extra,
  };
}

function graph(overrides: Partial<GameGraph> = {}): GameGraph {
  return {
    game: {
      id: "g",
      slug: "g",
      name: "g",
      status: "active",
      outcome: null,
      clock: 3,
      version: 2,
      contentVersion: "v",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    world: { id: "w", name: "世界", contentKey: "k" },
    stages: [stage("hall", 0), stage("yard", 1)],
    connections: [
      { id: "c1", fromStageId: "hall", toStageId: "yard", passage: "open" },
      { id: "c2", fromStageId: "yard", toStageId: "hall", passage: "sealed" },
    ],
    actors: [actor("a", "hall", 1), actor("b", "hall", 2), actor("c", "yard", 3)],
    order: {
      id: "o",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      completedAt: null,
      clock: 3,
      gameVersion: 2,
      nextActor: { position: 2, actorId: "b", actorName: "b", control: "agent" },
      entries: [
        {
          actorId: "b",
          actorName: "b",
          position: 2,
          agility: 2,
          turnsTaken: 1,
          control: "agent",
          alive: false,
        },
        {
          actorId: "a",
          actorName: "a",
          position: 1,
          agility: 3,
          turnsTaken: 0,
          control: "player",
          alive: true,
        },
      ],
    },
    ...overrides,
  };
}

describe("queueRows", () => {
  it("按名次排，并标出顺位上的下一个人", () => {
    expect(queueRows(graph()).map((row) => [row.position, row.actorId, row.isNext])).toEqual([
      [1, "a", false],
      [2, "b", true],
    ]);
  });

  it("没有顺位就是空表", () => {
    expect(queueRows(graph({ order: null }))).toEqual([]);
  });
});

describe("nextStageId", () => {
  it("下一个人的舞台从这里查", () => {
    expect(nextStageId(graph())).toBe("hall");
  });

  it("顺位没开时没有下一个", () => {
    expect(nextStageId(graph({ order: null }))).toBeUndefined();
  });
});

describe("stagePeople", () => {
  it("按舞台数人头", () => {
    const counts = stagePeople(graph());
    expect(counts.get("hall")).toBe(2);
    expect(counts.get("yard")).toBe(1);
  });
});

describe("stageView", () => {
  it("顺位上的人按名次在前，不在顺位上的按序号接在后面", () => {
    const view = stageView(graph(), "hall");
    expect(view?.actors.map((row) => row.actor.id)).toEqual(["a", "b"]);
  });

  it("没进顺位的人也在，按实体序号稳定排在后面", () => {
    const withExtra = graph({
      actors: [actor("a", "hall", 2), actor("z", "hall", 1)],
    });
    const view = stageView(withExtra, "hall");
    expect(view?.actors.map((row) => row.actor.id)).toEqual(["a", "z"]);
  });

  it("邻舞台两个方向都列出来，通行状态照抄", () => {
    const view = stageView(graph(), "hall");
    expect(view?.neighbours.map((item) => [item.stage.id, item.direction, item.passage])).toEqual([
      ["yard", "out", "open"],
      ["yard", "in", "sealed"],
    ]);

    const yard = stageView(graph(), "yard");
    expect(yard?.neighbours.map((item) => [item.stage.id, item.direction, item.passage])).toEqual([
      ["hall", "in", "open"],
      ["hall", "out", "sealed"],
    ]);
  });

  it("舞台不存在时返回 undefined，不抛", () => {
    expect(stageView(graph(), "nowhere")).toBeUndefined();
  });
});

describe("entityIndex", () => {
  it("舞台、actor、道具都能从根上查到，并带上归属", () => {
    const indexed = graph({
      actors: [actor("a", "hall", 1, { items: [{ id: "i1", name: "铁锹", description: "钝了" }] })],
      stages: [
        stage("hall", 0, {
          anchors: [
            {
              key: "peg",
              label: "木杆",
              items: [{ id: "i2", name: "骨哨", description: "" }],
            },
          ],
        }),
      ],
    });

    const entries = entityIndex(indexed);
    expect(entries.find((entry) => entry.kind === "stage" && entry.id === "hall")?.stageId).toBe(
      "hall",
    );
    expect(entries.find((entry) => entry.kind === "actor" && entry.id === "a")?.stageId).toBe(
      "hall",
    );
    const sword = entries.find((entry) => entry.kind === "item" && entry.label === "铁锹");
    expect(sword).toMatchObject({ stageId: "hall", actorId: "a" });
    const whistle = entries.find((entry) => entry.kind === "item" && entry.label === "骨哨");
    expect(whistle).toMatchObject({ stageId: "hall" });
    expect(whistle?.actorId).toBeUndefined();
    // 描述进关键字：搜索框按描述也能命中。
    expect(whistle?.keywords).toContain("木杆");
  });
});
