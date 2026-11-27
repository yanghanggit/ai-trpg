import { describe, expect, it } from "vitest";
import type { GameGraph } from "../../features/games/useGameGraph";
import { advanceReadings } from "./advanceReadings";

type Actor = GameGraph["actors"][number];
type Entry = NonNullable<GameGraph["order"]>["entries"][number];
type Round = NonNullable<GameGraph["round"]>;

function actor(id: string, stageId: string): Actor {
  return { id, name: id, stageId } as Actor;
}

function entry(actorName: string, turnsTaken: number, control: "agent" | "player" = "agent") {
  return {
    actorId: actorName,
    actorName,
    position: 1,
    agility: 5,
    turnsTaken,
    control,
    alive: true,
  } as Entry;
}

function graph(
  overrides: Partial<GameGraph> & {
    order?: NonNullable<GameGraph["order"]> | null;
    round?: Round | null;
  } = {},
): GameGraph {
  return {
    game: { id: "g", slug: "s", name: "n", status: "active", outcome: null, clock: 5, version: 9 },
    world: { id: "w", name: "世界", contentKey: "k" },
    stages: [
      { id: "cellar", name: "地窖" },
      { id: "yard", name: "墓园" },
    ],
    connections: [],
    actors: [actor("鼠王", "cellar"), actor("小狗", "yard")],
    order: {
      id: "o",
      status: "active",
      createdAt: "2026-01-02T03:04:05.000Z",
      completedAt: null,
      clock: 5,
      gameVersion: 9,
      entries: [entry("鼠王", 3), entry("小狗", 0)],
      nextActor: { position: 2, actorId: "小狗", actorName: "小狗", control: "agent" },
    },
    round: { index: 1, actors: [], stages: [], world: false },
    ...overrides,
  } as unknown as GameGraph;
}

function round(overrides: Partial<Round> = {}): Round {
  return { index: 1, actors: [], stages: [], world: false, ...overrides };
}

describe("advanceReadings", () => {
  it("没有顺位：只能开一条", () => {
    const readings = advanceReadings(graph({ order: null, round: null }), null);
    expect(readings.hasOrder).toBe(false);
    expect(readings.rows).toEqual([]);
    expect(readings.nextStep).toBe("开一条顺位");
  });

  it("编排表按名次排，舞台跟着人走", () => {
    const readings = advanceReadings(
      graph(),
      round({ actors: [{ actorId: "鼠王", name: "鼠王", empty: false }] }),
    );
    expect(readings.rows.map((row) => [row.position, row.actorName, row.stageName])).toEqual([
      [1, "鼠王", "地窖"],
      [1, "小狗", "墓园"],
    ]);
    expect(readings.rows[0]?.actedThisRound).toBe(true);
    expect(readings.rows[1]?.actedThisRound).toBe(false);
    expect(readings.rows[1]?.isNext).toBe(true);
    expect(readings.nextStep).toContain("NPC 小狗");
    expect(readings.nextStep).toContain("墓园");
  });

  it("world 的读数来自回合账：账上推过就是推过，不看计数", () => {
    const base = graph();
    const order = base.order as NonNullable<GameGraph["order"]>;
    const even = { ...order, entries: [entry("鼠王", 3), entry("小狗", 3)] };

    const pending = advanceReadings(
      graph({ order: even, round: round({ actors: [], world: false }) }),
      round({ actors: [], world: false }),
    );
    expect(pending.roundDone).toBe(true);
    expect(pending.worldPushed).toBe(false);
    expect(pending.roundClosed).toBe(false);
    expect(pending.nextStep).toContain("world 回合");

    const closed = advanceReadings(
      graph({ order: even, round: round({ world: true }) }),
      round({ world: true }),
    );
    expect(closed.roundClosed).toBe(true);
  });

  it("轮到玩家席位时停手，并说清楚为什么", () => {
    const base = graph();
    const order = base.order as NonNullable<GameGraph["order"]>;
    const readings = advanceReadings(
      graph({
        order: {
          ...order,
          nextActor: { position: 2, actorId: "小狗", actorName: "小狗", control: "player" },
        },
      }),
      round(),
    );
    expect(readings.blocked).toContain("玩家席位");
    expect(readings.nextStep).toBe("停在玩家席位");
  });

  it("顺位上没有活人：下一步是收工", () => {
    const base = graph();
    const order = base.order as NonNullable<GameGraph["order"]>;
    const readings = advanceReadings(graph({ order: { ...order, nextActor: null } }), round());
    expect(readings.blocked).toBeUndefined();
    expect(readings.nextStep).toContain("收工");
  });

  it("空过在表上标出来，不混成「动过」", () => {
    const readings = advanceReadings(
      graph(),
      round({ actors: [{ actorId: "鼠王", name: "鼠王", empty: true }] }),
    );
    expect(readings.rows[0]?.actedThisRound).toBe(true);
    expect(readings.rows[0]?.emptyThisRound).toBe(true);
  });
});
