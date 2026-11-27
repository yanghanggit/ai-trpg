import { describe, expect, it } from "vitest";
import type { GameGraph } from "../../features/games/useGameGraph";
import { advanceReadings } from "./advanceReadings";

type Actor = GameGraph["actors"][number];
type Entry = NonNullable<GameGraph["order"]>["entries"][number];

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
  overrides: Partial<GameGraph> & { order?: NonNullable<GameGraph["order"]> | null } = {},
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
    ...overrides,
  } as unknown as GameGraph;
}

describe("advanceReadings", () => {
  it("没有顺位：什么都不能推，也不给下一步", () => {
    expect(advanceReadings(graph({ order: null }))).toEqual({
      hasOrder: false,
      next: null,
      counts: [],
      complete: false,
      chainAllowed: false,
    });
  });

  it("读出下一位、本轮计数与它所在的舞台", () => {
    const readings = advanceReadings(graph());
    expect(readings.hasOrder).toBe(true);
    expect(readings.next).toEqual({ position: 2, actorName: "小狗", player: false });
    expect(readings.counts).toEqual([3, 0]);
    expect(readings.complete).toBe(false);
    expect(readings.nextStage).toBe("墓园");
    expect(readings.chainAllowed).toBe(true);
  });

  it("轮到玩家席位时编排停手", () => {
    const base = graph();
    const order = base.order as NonNullable<GameGraph["order"]>;
    const readings = advanceReadings(
      graph({
        order: {
          ...order,
          nextActor: { position: 2, actorId: "小狗", actorName: "小狗", control: "player" },
        },
      }),
    );
    expect(readings.next?.player).toBe(true);
    expect(readings.chainAllowed).toBe(false);
  });

  it("活人计数齐平才算这一轮走完", () => {
    const base = graph();
    const order = base.order as NonNullable<GameGraph["order"]>;
    const readings = advanceReadings(
      graph({ order: { ...order, entries: [entry("鼠王", 3), entry("小狗", 3)] } }),
    );
    expect(readings.complete).toBe(true);
  });

  it("顺位上没有活人时不给出下一步", () => {
    const base = graph();
    const order = base.order as NonNullable<GameGraph["order"]>;
    const readings = advanceReadings(graph({ order: { ...order, nextActor: null } }));
    expect(readings.next).toBeNull();
    expect(readings.chainAllowed).toBe(false);
  });
});
