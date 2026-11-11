import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/db/env";
import { eq } from "drizzle-orm";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { DEMO_USER } from "../src/db/demo-fixture";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import { appearances } from "../src/db/schema";
import { createGame, getGameState } from "../src/game";
import { resolveAppearance } from "../src/game/agents/appearance/form";
import { recordAppearance } from "../src/game/persistence/appearances";
import { TEST_WORLD } from "./test-world";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

/**
 * 签名（signature）只持有稳定形态；「别人此刻看到的样子」是签名下的一条
 * append-only 外观记录。伪装 / 变身将来靠切换签名实现。
 */
describe.skipIf(!testDatabaseUrl)("actor signatures", () => {
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

  it("creates exactly one current signature per actor", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "签名测试局",
      world: TEST_WORLD,
    });
    const state = await getGameState(handle.db, created.game.slug);
    const actors = state.world.stages.flatMap((stage) => stage.actors);

    expect(actors).toHaveLength(TEST_WORLD.actors.length);
    const signatureIds = actors.map((actor) => actor.signature.id);
    const signatureSeqs = actors.map((actor) => actor.signature.seq);
    expect(new Set(signatureIds).size).toBe(actors.length);
    expect(new Set(signatureSeqs).size).toBe(actors.length);

    for (const actor of actors) {
      const source = TEST_WORLD.actors.find((candidate) => candidate.key === actor.key);
      if (!source) {
        throw new Error(`缺少 actor 内容: ${actor.key}`);
      }
      expect(actor.appearance.text).toBe(resolveAppearance(source.signature));
      expect(actor.signature.form).toBe(source.signature.form);

      const rows = await handle.db
        .select()
        .from(appearances)
        .where(eq(appearances.signatureId, actor.signature.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(actor.appearance.id);
      expect(rows[0]?.source).toBe("seed");
      const input = rows[0]?.input;
      if (input?.source !== "seed") {
        throw new Error("缺少种子外观快照");
      }
      expect(input.actorKey).toBe(source.key);
      expect(input.form).toBe(source.signature.form);
      expect(input.fallback).toBe(!source.signature.appearance?.trim());
    }
  });

  it("appends appearance rows and keeps only one current row per signature", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "签名存储测试局",
      world: TEST_WORLD,
    });
    const state = await getGameState(handle.db, created.game.slug);
    const actor = state.world.stages.flatMap((stage) => stage.actors)[0];
    if (!actor) {
      throw new Error("缺少 actor");
    }

    const initialRows = await handle.db
      .select()
      .from(appearances)
      .where(eq(appearances.signatureId, actor.signature.id));
    expect(initialRows).toHaveLength(1);

    await handle.db.transaction(async (tx) => {
      await recordAppearance(tx, {
        gameId: created.game.id,
        actorId: actor.id,
        text: "被雨淋透的旧斗篷。",
        input: {
          source: "runtime",
          model: null,
          prompt: { messages: [], inputMessage: "test", tools: [], maxRounds: 1 },
          context: {
            task: "update",
            form: actor.signature.form,
            contentVersion: "test",
            worn: [],
          },
        },
        now: new Date(),
      });
    });

    const updated = await getGameState(handle.db, created.game.slug);
    const reloaded = updated.world.stages.flatMap((stage) => stage.actors)[0];
    expect(reloaded?.appearance.text).toBe("被雨淋透的旧斗篷。");
    expect(reloaded?.appearance.id).not.toBe(actor.appearance.id);
    expect(reloaded?.signature.id).toBe(actor.signature.id);

    const rows = await handle.db
      .select()
      .from(appearances)
      .where(eq(appearances.signatureId, actor.signature.id));
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.supersededAt === null)).toHaveLength(1);
  });

  it("rejects content without an actor key", async () => {
    const world = {
      ...TEST_WORLD,
      actors: TEST_WORLD.actors.map(({ key: _key, ...rest }) => rest),
    } as unknown as typeof TEST_WORLD;
    await expect(
      createGame(handle.db, { username: DEMO_USER.username, name: "缺 key 局", world }),
    ).rejects.toThrow();
  });
});
