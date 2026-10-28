import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { DEMO_USER } from "../src/db/demo-fixture";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import { createGame, getGameState, playerPickup, takeActorControl } from "../src/game";
import type { GameState } from "../src/game/types";
import { TEST_WORLD } from "./test-world";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

const PICKUP_WORLD = {
  ...TEST_WORLD,
  stages: TEST_WORLD.stages.map((stage) =>
    stage.key === "gate"
      ? {
          ...stage,
          items: [
            {
              key: "test-torch",
              name: "武器.测试火把",
              description: "测试用的场景武器。",
              kind: "weapon" as const,
              count: 1,
              stats: { damage: 7, block: 1 },
              effect: { type: "damage" },
            },
          ],
        }
      : stage,
  ),
};

function entityRows(state: GameState): { key: string; seq: number }[] {
  const rows: { key: string; seq: number }[] = [
    { key: `world:${state.world.name}`, seq: state.world.seq },
  ];
  for (const stage of state.world.stages) {
    rows.push({ key: `stage:${stage.name}`, seq: stage.seq });
    for (const item of stage.items) {
      rows.push({ key: `item:${item.name}`, seq: item.seq });
    }
    for (const actor of stage.actors) {
      rows.push({ key: `actor:${actor.name}`, seq: actor.seq });
      rows.push({ key: `presentation:${actor.name}`, seq: actor.presentation.seq });
      for (const item of actor.items) {
        rows.push({ key: `item:${item.name}`, seq: item.seq });
      }
    }
  }
  return rows;
}

function maxSeq(state: GameState): number {
  return Math.max(...entityRows(state).map((row) => row.seq));
}

describe.skipIf(!testDatabaseUrl)("entity seq", () => {
  let handle: DatabaseHandle;

  beforeAll(async () => {
    handle = openDatabase("TEST_DATABASE_URL");
    await runMigrations(handle.db);
    await resetDomainData(handle.db);
    await seedDemoData(handle.db);
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  it("assigns a dense, unique sequence across world, stages, actors, presentations and items", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "序号测试局",
      world: TEST_WORLD,
    });
    const state = await getGameState(handle.db, created.game.slug);
    const seqs = entityRows(state).map((row) => row.seq);

    expect(new Set(seqs).size).toBe(seqs.length);
    expect(Math.min(...seqs)).toBe(1);
    expect(Math.max(...seqs)).toBe(seqs.length);
    expect(seqs.every((seq) => Number.isInteger(seq) && seq > 0)).toBe(true);
  });

  it("gives the same content the same order in every game", async () => {
    const first = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "序号复现甲",
      world: TEST_WORLD,
    });
    const second = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "序号复现乙",
      world: TEST_WORLD,
    });

    const firstRows = entityRows(await getGameState(handle.db, first.game.slug));
    const secondRows = entityRows(await getGameState(handle.db, second.game.slug));
    expect(Object.fromEntries(secondRows.map((row) => [row.key, row.seq]))).toEqual(
      Object.fromEntries(firstRows.map((row) => [row.key, row.seq])),
    );
  });

  it("keeps the item's sequence when it changes owner", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "序号拾取局",
      world: PICKUP_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    const before = await getGameState(handle.db, created.game.slug);
    const torchBefore = before.world.stages
      .flatMap((stage) => stage.items)
      .find((item) => item.name === "武器.测试火把");
    const picked = await playerPickup(handle.db, created.game.slug, "守烬人", {
      itemName: "武器.测试火把",
    });
    expect(picked.ok).toBe(true);

    const after = await getGameState(handle.db, created.game.slug);
    const keeper = after.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "守烬人");
    const torch = keeper?.items.find((item) => item.name === "武器.测试火把");

    expect(torch?.seq).toBe(torchBefore?.seq);
    expect(maxSeq(after)).toBe(maxSeq(before));
    expect(after.world.stages.flatMap((stage) => stage.items)).toHaveLength(0);
    const seqs = entityRows(after).map((row) => row.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
  });
});
