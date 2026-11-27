import { describe, expect, it } from "vitest";
import type { GameGraph } from "../../../features/games/useGameGraph";
import {
  connectionPairs,
  describeCensus,
  describePassage,
  entityIndex,
  nextStageId,
  queueRows,
  stageCensus,
  stageView,
} from "./viewModel";

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
    round: { index: 1, actors: [], stages: [], world: false },
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

describe("stageCensus", () => {
  it("按舞台分开数活人与尸体", () => {
    const census = stageCensus(
      graph({
        actors: [actor("a", "hall", 1), actor("b", "hall", 2, { hp: 0 }), actor("c", "yard", 3)],
      }),
    );
    expect(census.get("hall")).toEqual({ alive: 1, dead: 1 });
    expect(census.get("yard")).toEqual({ alive: 1, dead: 0 });
  });

  it("顺位上有权威答案时以它为准，没有才看血", () => {
    const order = {
      id: "o",
      status: "active" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      completedAt: null,
      clock: 1,
      gameVersion: 1,
      nextActor: null,
      // 血还满着，但顺位说他已经倒下：账上的答案优先。
      entries: [
        {
          actorId: "a",
          actorName: "a",
          position: 1,
          agility: 5,
          turnsTaken: 0,
          control: "agent" as const,
          alive: false,
        },
      ],
    };
    const census = stageCensus(
      graph({ actors: [actor("a", "hall", 1), actor("b", "hall", 2)], order }),
    );
    expect(census.get("hall")).toEqual({ alive: 1, dead: 1 });
  });
});

describe("describeCensus", () => {
  it("空舞台、只有活人、活人加尸体三种读法", () => {
    expect(describeCensus({ alive: 0, dead: 0 })).toBe("空");
    expect(describeCensus({ alive: 2, dead: 0 })).toBe("活 2");
    expect(describeCensus({ alive: 2, dead: 1 })).toBe("活 2 / 死 1");
    expect(describeCensus({ alive: 0, dead: 1 })).toBe("活 0 / 死 1");
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

  it("一个邻居一行，两个方向的通行状态各就各位", () => {
    const view = stageView(graph(), "hall");
    expect(view?.neighbours.map((item) => [item.stage.id, item.out, item.in])).toEqual([
      ["yard", "open", "sealed"],
    ]);

    // 换到对面看同一条线：去与来正好互换，行的顺序仍按邻居序号。
    const yard = stageView(graph(), "yard");
    expect(yard?.neighbours.map((item) => [item.stage.id, item.out, item.in])).toEqual([
      ["hall", "sealed", "open"],
    ]);
  });

  it("只有单向通路时，另一侧是 null", () => {
    const oneWay = graph({
      connections: [
        { id: "c1", fromStageId: "hall", toStageId: "yard", passage: "open" },
      ] as GameGraph["connections"],
    });
    const view = stageView(oneWay, "hall");
    expect(view?.neighbours.map((item) => [item.stage.id, item.out, item.in])).toEqual([
      ["yard", "open", null],
    ]);
  });

  it("舞台不存在时返回 undefined，不抛", () => {
    expect(stageView(graph(), "nowhere")).toBeUndefined();
  });
});

describe("describePassage", () => {
  it("两个方向各说各的，缺的方向说没有路", () => {
    const [yard] = stageView(graph(), "hall")?.neighbours ?? [];
    expect(yard === undefined ? "" : describePassage(yard)).toBe("与yard：去能走，来封着");

    const [hall] = stageView(graph(), "yard")?.neighbours ?? [];
    expect(hall === undefined ? "" : describePassage(hall)).toBe("与hall：去封着，来能走");
  });

  it("单向通路里缺掉的那一半写「没有路」", () => {
    const oneWay = graph({
      connections: [
        { id: "c1", fromStageId: "hall", toStageId: "yard", passage: "sealed" },
      ] as GameGraph["connections"],
    });
    const [exit] = stageView(oneWay, "hall")?.neighbours ?? [];
    expect(exit === undefined ? "" : describePassage(exit)).toBe("与yard：去封着，来没有路");
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

describe("connectionPairs", () => {
  it("一对舞台一条线：双向的两条边折成一个 pair", () => {
    const [pair, ...rest] = connectionPairs(graph());
    expect(rest).toHaveLength(0);
    expect(pair?.directions.map((direction) => direction.passage)).toEqual(["open", "sealed"]);
    expect(pair?.passable).toBe(true);
  });

  it("单向的只留一个方向，线是「通」", () => {
    const pairs = connectionPairs(
      graph({
        connections: [{ id: "c", fromStageId: "hall", toStageId: "yard", passage: "open" }],
      }),
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.directions).toHaveLength(1);
    expect(pairs[0]?.passable).toBe(true);
  });

  it("两个方向都封着时整条线不可通行", () => {
    const pairs = connectionPairs(
      graph({
        connections: [
          { id: "c1", fromStageId: "hall", toStageId: "yard", passage: "sealed" },
          { id: "c2", fromStageId: "yard", toStageId: "hall", passage: "sealed" },
        ],
      }),
    );
    expect(pairs[0]?.directions).toHaveLength(2);
    expect(pairs[0]?.passable).toBe(false);
  });

  it("自环不画；顺序稳定，刷新前后线不会换位置", () => {
    const pairs = connectionPairs(
      graph({
        connections: [
          { id: "c1", fromStageId: "hall", toStageId: "hall", passage: "open" },
          { id: "c2", fromStageId: "yard", toStageId: "hall", passage: "open" },
        ],
      }),
    );
    expect(pairs).toHaveLength(1);
    const ids = pairs[0]?.stageIds ?? [];
    expect(ids).toEqual([...ids].sort());
    expect(connectionPairs(graph())).toEqual(connectionPairs(graph()));
  });
});
