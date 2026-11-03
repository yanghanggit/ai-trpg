import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_USER } from "../src/db/demo-fixture";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import {
  dumpMemory,
  MEMORIES_DIR_ENV,
  memoriesRoot,
  memoryDumpFileName,
  renderMemoryMarkdown,
} from "../src/debug/memory-dump";
import {
  createGame,
  getGameState,
  getMemoryState,
  playerWait,
  resolveMemoryOwner,
  takeActorControl,
} from "../src/game";
import type { AgentMemoryState } from "../src/game/types";
import { TEST_WORLD } from "./test-world";

const actorMemory: AgentMemoryState = {
  id: "memory-1",
  ownerType: "actor",
  ownerId: "actor-1",
  name: "奥德里克",
  contextUsageRatio: 0.42,
  messages: [
    {
      sequence: 1,
      type: "system",
      content: "# 奥德里克\n\n你扮演角色: 奥德里克\n\n```\n内部代码块\n```",
      metadata: { kind: "actor_system_prompt" },
      createdAt: "2026-11-03T12:00:00.000Z",
    },
    {
      sequence: 2,
      type: "human",
      content: "# 认知\n你把 #19 记作「棺里爬出来的」。",
      metadata: { kind: "identity_update" },
      createdAt: "2026-11-03T12:00:01.000Z",
    },
    {
      sequence: 3,
      type: "human",
      content: "# 你听见\n#19公开说（场景：墓园）：我叫无名者。",
      metadata: {
        kind: "communication_observation",
        visibility: "stage",
        communicationKind: "announce",
        dialogue: "台词里有反引号 ` 与竖线 |",
      },
      createdAt: "2026-11-03T12:00:02.000Z",
    },
    {
      sequence: 4,
      type: "ai",
      content: "",
      toolCalls: [
        {
          id: "call-1",
          type: "function",
          function: { name: "look_stage", arguments: "{}" },
        },
      ],
      metadata: { kind: "actor_system_prompt" },
      createdAt: "2026-11-03T12:00:03.000Z",
    },
    {
      sequence: 5,
      type: "tool",
      content: "场景：墓园\n角色：你、#19",
      toolCallId: "call-1",
      createdAt: "2026-11-03T12:00:04.000Z",
    },
  ],
};

const game = {
  id: "game-1",
  name: "探针认知局",
  slug: "probe-recognition",
  status: "active",
  version: 2,
  contentVersion: "dark-fantasy.v15",
};

describe("memory dump render", () => {
  it("renders a stable, AI-readable memory document", () => {
    const now = new Date("2026-11-03T12:34:56");
    const text = renderMemoryMarkdown({ game, memory: actorMemory, now });

    expect(text).toContain("# 记忆快照 · 奥德里克");
    expect(text).toContain("- slug: probe-recognition");
    expect(text).toContain("- 游戏版本: 2");
    expect(text).toContain("- 所有者: actor（角色）· 奥德里克");
    expect(text).toContain("- 消息数: 5");
    expect(text).toContain("- 上下文占用: 42%");
    expect(text).toContain("## 记忆类别");
    expect(text).toContain("- identity_update: 1");
    expect(text).toContain("| 2 | human | identity_update | - |");
    expect(text).toContain("### #2 · human · identity_update");
    expect(text).toContain("### #5 · tool · -");
    expect(text).toContain("- tool_call_id: call-1");
    expect(text).toContain("- 时间: 2026-11-03T12:00:04.000Z");
    // 正文按 sequence 原样进入围栏；内部标题不会破坏外层结构。
    expect(text).toContain("你把 #19 记作「棺里爬出来的」。");
    expect(text).toContain("tool_calls:");
  });

  it("keeps fenced content and metadata intact", () => {
    const text = renderMemoryMarkdown({ game, memory: actorMemory });

    // 原文里有三个反引号，围栏必须更长。
    expect(text).toContain("````text\n# 奥德里克");
    // metadata 含反引号时退回 JSON 围栏，不塞进行内代码。
    expect(text).not.toContain('"dialogue":"台词里有反引号');
    expect(text).toContain("台词里有反引号 ` 与竖线 |");
  });

  it("names files by time, game version and owner", () => {
    expect(memoryDumpFileName(game, actorMemory, new Date("2026-11-03T12:34:56"))).toBe(
      "20261103_123456-v2-actor-奥德里克.md",
    );
    expect(
      memoryDumpFileName(
        game,
        { ownerType: "world", name: "枯钟修道院" },
        new Date("2026-11-03T12:34:56"),
      ),
    ).toBe("20261103_123456-v2-world-枯钟修道院.md");
  });
});

describe("memory dump file", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "ai-trpg-memories-"));
  });

  afterAll(async () => {
    delete process.env[MEMORIES_DIR_ENV];
    await rm(root, { recursive: true, force: true });
  });

  it("writes into <root>/<gameSlug>/ and avoids overwriting", async () => {
    const now = new Date("2026-11-03T12:34:56");
    const first = await dumpMemory({ game, memory: actorMemory, now }, { root });
    const second = await dumpMemory({ game, memory: actorMemory, now }, { root });

    expect(first).toBe(join(root, game.slug, "20261103_123456-v2-actor-奥德里克.md"));
    expect(second).toBe(join(root, game.slug, "20261103_123456-v2-actor-奥德里克_2.md"));
    expect(await readFile(first, "utf8")).toContain("# 记忆快照 · 奥德里克");
  });

  it("writes to an explicit .md path and treats other paths as directories", async () => {
    const explicit = await dumpMemory(
      { game, memory: actorMemory, now: new Date("2026-11-03T12:34:57") },
      { root, out: join(root, "custom", "memory.md") },
    );
    expect(explicit).toBe(join(root, "custom", "memory.md"));
    expect(await readFile(explicit, "utf8")).toContain("- 局: 探针认知局");

    const directory = await dumpMemory(
      { game, memory: actorMemory, now: new Date("2026-11-03T12:34:58") },
      { root, out: join(root, "by-hand") },
    );
    expect(directory).toBe(join(root, "by-hand", "20261103_123458-v2-actor-奥德里克.md"));
  });

  it("uses MEMORIES_DIR when no root is given", async () => {
    process.env[MEMORIES_DIR_ENV] = root;
    expect(memoriesRoot()).toBe(root);
    const path = await dumpMemory({ game, memory: actorMemory });
    expect(path.startsWith(join(root, game.slug))).toBe(true);
  });
});

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

describe.skipIf(!testDatabaseUrl)("memory dump from database", () => {
  let handle: DatabaseHandle;
  let root: string;

  beforeAll(async () => {
    handle = openDatabase("TEST_DATABASE_URL");
    await runMigrations(handle.db);
    await resetDomainData(handle.db);
    await seedDemoData(handle.db);
    root = await mkdtemp(join(tmpdir(), "ai-trpg-memories-db-"));
  });

  afterAll(async () => {
    await handle.pool.end();
    await rm(root, { recursive: true, force: true });
  });

  it("dumps an actor's current memory without touching game state", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "记忆导出测试局",
      world: TEST_WORLD,
    });
    const slug = created.game.slug;
    await takeActorControl(handle.db, slug, "守烬人");
    await playerWait(handle.db, slug, "守烬人");

    const before = await getGameState(handle.db, slug);
    const owner = resolveMemoryOwner(before, "actor", "守烬人");
    const memory = await getMemoryState(handle.db, before.game.id, owner.ownerType, owner.ownerId);
    expect(memory).toBeDefined();

    const path = await dumpMemory(
      { game: before.game, memory: memory as AgentMemoryState },
      { root },
    );
    const text = await readFile(path, "utf8");

    expect(path).toContain(`v${before.game.version}-actor-守烬人.md`);
    expect(text).toContain("# 记忆快照 · 守烬人");
    expect(text).toContain("action_feedback");
    expect(text).toContain("你留在原地");
    // probe / memory dump 不注入当前 observation。
    expect(text).not.toContain("## 场景物品");

    const after = await getGameState(handle.db, slug);
    const afterOwner = resolveMemoryOwner(after, "actor", "守烬人");
    const afterMemory = await getMemoryState(
      handle.db,
      after.game.id,
      afterOwner.ownerType,
      afterOwner.ownerId,
    );
    expect(after.game.version).toBe(before.game.version);
    expect(afterMemory?.messages.length).toBe(memory?.messages.length);

    expect(resolveMemoryOwner(after, "stage", "灰烬门廊").ownerId).toBe(
      after.world.stages.find((stage) => stage.name === "灰烬门廊")?.id,
    );
    expect(resolveMemoryOwner(after, "world").ownerId).toBe(after.world.id);
  });
});
