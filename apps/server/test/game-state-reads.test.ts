import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { DEMO_USER } from "../src/db/demo-fixture";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import {
  createGame,
  getGameMeta,
  getGameState,
  getGameStateSlice,
  isUuidShaped,
  listGameMessages,
  playerMove,
  resolveActorByNameInWorld,
  takeActorControl,
} from "../src/game";
import { TEST_WORLD } from "./test-world";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

describe("uuid 形状判断", () => {
  it("accepts every shape Postgres accepts as a uuid literal", () => {
    expect(isUuidShaped("123e4567-e89b-42d3-a456-426614174000")).toBe(true);
    expect(isUuidShaped("123e4567-e89b-72d3-a456-426614174000")).toBe(true); // v7
    expect(isUuidShaped("00000000-0000-0000-0000-000000000000")).toBe(true); // nil
    expect(isUuidShaped("123E4567-E89B-42D3-A456-426614174000")).toBe(true); // 大写
  });

  it("rejects strings that are not id-shaped", () => {
    expect(isUuidShaped("")).toBe(false);
    expect(isUuidShaped("灰烬门廊")).toBe(false);
    expect(isUuidShaped("not-a-uuid-or-slug")).toBe(false);
    expect(isUuidShaped("123e4567-e89b-42d3-a456-42661417400")).toBe(false); // 少一位
  });
});

describe.skipIf(!testDatabaseUrl)("game state reads", () => {
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

  const createGameWith = async (name: string) => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name,
      world: TEST_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");
    return created.game.slug;
  };

  it("keeps the public event stream out of the slice", async () => {
    const slug = await createGameWith("读取分层测试局");
    await playerMove(handle.db, slug, "守烬人", { targetStageRef: "断钟中殿" });

    const slice = await getGameStateSlice(handle.db, slug);
    const full = await getGameState(handle.db, slug);

    expect("messages" in slice).toBe(false);
    expect(full.messages.length).toBeGreaterThan(0);
    // 除事件流外两者必须完全一致：切片不是另一种状态，只是同一份状态少一个字段。
    const { messages: _messages, ...rest } = full;
    expect(slice).toEqual(rest);
  });

  it("pages the public event stream by sequence", async () => {
    const slug = await createGameWith("事件流分页测试局");
    await playerMove(handle.db, slug, "守烬人", { targetStageRef: "断钟中殿" });
    await playerMove(handle.db, slug, "守烬人", { targetStageRef: "灰烬门廊" });

    const all = await getGameState(handle.db, slug);
    const gameId = all.game.id;
    const sequences = all.messages.map((message) => message.sequence);
    const [first] = sequences;
    if (first === undefined || sequences.length < 2) {
      throw new Error("缺少测试数据：事件流至少要有两条");
    }

    const page = await listGameMessages(handle.db, gameId, { limit: 1 });
    expect(page.map((message) => message.sequence)).toEqual([first]);

    const tail = await listGameMessages(handle.db, gameId, { afterSequence: first });
    expect(tail.map((message) => message.sequence)).toEqual(sequences.slice(1));
  });

  it("delivers a turn as a slice plus a message cursor", async () => {
    const slug = await createGameWith("回合交付测试局");
    const before = await getGameState(handle.db, slug);
    const beforeCursor = before.messages.at(-1)?.sequence ?? 0;

    const result = await playerMove(handle.db, slug, "守烬人", { targetStageRef: "断钟中殿" });
    expect("messages" in result.state).toBe(false);
    expect(result.messageCursor).toBeGreaterThan(beforeCursor);

    // 客户端 / CLI 按游标增量拉：这里应当只拿到本回合产生的那条公共事件。
    const turnMessages = await listGameMessages(handle.db, before.game.id, {
      afterSequence: beforeCursor,
    });
    expect(turnMessages.map((message) => message.kind)).toEqual(["move"]);
    expect(turnMessages.at(-1)?.sequence).toBe(result.messageCursor);
  });

  it("resolves a game by id and reports malformed refs as not found", async () => {
    const slug = await createGameWith("按 id 读取测试局");
    const full = await getGameState(handle.db, slug);

    // slug 打空后走 id 分支；大小写不影响形状判断，Postgres 的 uuid 也不区分大小写。
    expect((await getGameState(handle.db, full.game.id)).game.id).toBe(full.game.id);
    expect((await getGameState(handle.db, full.game.id.toUpperCase())).game.id).toBe(full.game.id);
    expect((await getGameMeta(handle.db, full.game.id)).slug).toBe(slug);

    // 形状不像 uuid、slug 也不存在：应当是 not_found，而不是 Postgres 的 uuid 解析错误。
    await expect(getGameState(handle.db, "not-a-uuid-or-slug")).rejects.toThrow(/游戏不存在/);
    // 形状合法但库里没有：同样是 not_found。
    await expect(getGameState(handle.db, randomUUID())).rejects.toThrow(/游戏不存在/);
  });

  it("reads game meta and resolves actor ids without assembling the world", async () => {
    const slug = await createGameWith("窄读测试局");
    const full = await getGameState(handle.db, slug);

    const meta = await getGameMeta(handle.db, slug);
    expect(meta).toMatchObject({
      id: full.game.id,
      slug,
      status: "active",
      contentVersion: full.game.contentVersion,
      playerId: full.player.id,
      worldId: full.world.id,
    });

    const keeper = full.world.stages
      .flatMap((stage) => stage.actors.map((actor) => ({ stage, actor })))
      .find(({ actor }) => actor.name === "守烬人");
    const { actor, stage } = await resolveActorByNameInWorld(handle.db, meta.worldId, "守烬人");
    expect(actor.id).toBe(keeper?.actor.id);
    expect(stage.id).toBe(keeper?.stage.id);
    expect(actor.seq).toBe(keeper?.actor.seq);
    expect(actor.name).toBe("守烬人");

    await expect(getGameMeta(handle.db, "不存在的一局")).rejects.toThrow(/游戏不存在/);
    await expect(resolveActorByNameInWorld(handle.db, meta.worldId, "不存在的人")).rejects.toThrow(
      /actor 不存在/,
    );
  });
});
