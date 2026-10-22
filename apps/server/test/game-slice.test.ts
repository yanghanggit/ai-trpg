import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DARK_FANTASY_SEED, DEMO_USER } from "../seeds/dark-fantasy";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import { loadSnapshot } from "../src/debug/snapshot";
import { createGame, getGameState, runAction, snapshotGame } from "../src/game";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

describe.skipIf(!testDatabaseUrl)("first game vertical slice", () => {
  let handle: DatabaseHandle;
  let snapshotRoot: string;

  beforeAll(async () => {
    handle = openDatabase("TEST_DATABASE_URL");
    await runMigrations(handle.db);
    await resetDomainData(handle.db);
    await seedDemoData(handle.db);
    snapshotRoot = await mkdtemp(join(tmpdir(), "ai-trpg-game-slice-"));
  });

  afterAll(async () => {
    await handle.pool.end();
    await rm(snapshotRoot, { recursive: true, force: true });
  });

  it("creates a single-player game and advances it through one stage connection", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "灰烬测试局",
      seed: DARK_FANTASY_SEED,
    });

    expect(created.player.username).toBe(DEMO_USER.username);
    expect(created.world.stages).toHaveLength(2);
    expect(created.world.connections).toHaveLength(1);
    expect(created.world.stages.map((stage) => stage.name)).toEqual(["灰烬门廊", "断钟中殿"]);

    const gate = created.world.stages[0];
    expect(gate?.actors[0]?.name).toBe("守烬人");
    expect(gate?.actors[0]?.items[0]?.name).toBe("裂齿短刃");
    expect(created.messages).toHaveLength(1);

    const moved = await runAction(handle.db, created.game.slug, {
      type: "move",
      to: "断钟中殿",
    });

    expect(moved.game.version).toBe(1);
    expect(moved.messages.map((message) => message.kind)).toEqual([
      "narration",
      "player",
      "narration",
    ]);
    const actorStages = moved.world.stages.flatMap((stage) =>
      stage.actors.map((actor) => [actor.name, stage.name] as const),
    );
    expect(actorStages).toEqual([["守烬人", "断钟中殿"]]);

    const current = await getGameState(handle.db, created.game.id);
    expect(current.game.version).toBe(1);

    const result = await snapshotGame(handle.db, created.game.slug, {
      root: snapshotRoot,
      action: "move",
    });
    expect(result.snapshot.manifest).toMatchObject({
      user: DEMO_USER.username,
      game: created.game.slug,
      action: "move",
      source: "db",
      dbVersion: 1,
      contentVersion: DARK_FANTASY_SEED.contentVersion,
    });
    expect(result.snapshot.manifest.parts).toEqual(["game.json", "messages.json"]);

    const loaded = await loadSnapshot(result.snapshot.path);
    expect(loaded.manifest.source).toBe("db");
    expect(loaded.session).toHaveLength(3);
  });
});
