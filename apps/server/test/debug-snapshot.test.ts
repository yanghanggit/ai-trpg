import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findLatestSnapshot,
  formatSnapshotId,
  listSnapshots,
  loadSnapshot,
  type SessionEvent,
  saveSnapshot,
} from "../src/debug/snapshot";

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ai-trpg-worlds-"));
  roots.push(root);
  return root;
}

function events(): SessionEvent[] {
  return [
    {
      sequence: 1,
      type: "session.created",
      at: "2026-10-22T00:00:00.000Z",
      payload: { user: "alice" },
    },
    {
      sequence: 2,
      type: "action.applied",
      at: "2026-10-22T00:00:01.000Z",
      payload: { action: "noop" },
    },
  ];
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("snapshot store", () => {
  it("保存并还原完整快照（world / session / parts）", async () => {
    const root = await makeRoot();
    const saved = await saveSnapshot({
      root,
      user: "alice",
      game: "Game1",
      world: { mode: "home", turn: 0 },
      session: events(),
      parts: {
        "entities/角色.无名.json": { name: "角色.无名", hp: 10 },
        "dungeon/room.json": { name: "入口", type: "opening" },
      },
      action: "new",
      now: new Date("2026-10-22T00:00:00.000Z"),
    });

    expect(saved.path).toBe(
      join(root, "alice", "Game1", formatSnapshotId(new Date("2026-10-22T00:00:00.000Z"))),
    );
    expect(saved.manifest).toMatchObject({
      schemaVersion: 1,
      user: "alice",
      game: "Game1",
      action: "new",
      parts: ["dungeon/room.json", "entities/角色.无名.json"],
    });

    const manifest = JSON.parse(
      await readFile(join(saved.path, "manifest.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(manifest.schemaVersion).toBe(1);

    const sessionRaw = await readFile(join(saved.path, "session.jsonl"), "utf8");
    expect(sessionRaw.trim().split("\n")).toHaveLength(2);

    const restored = await loadSnapshot(saved.path);
    expect(restored).toEqual(saved);
  });

  it("按创建时间排序并返回最新快照", async () => {
    const root = await makeRoot();
    await saveSnapshot({
      root,
      user: "alice",
      game: "Game1",
      world: { turn: 1 },
      action: "turn",
      now: new Date("2026-10-22T00:00:00.000Z"),
    });
    await saveSnapshot({
      root,
      user: "alice",
      game: "Game1",
      world: { turn: 2 },
      action: "turn",
      now: new Date("2026-10-22T00:00:01.000Z"),
    });

    const snapshots = await listSnapshots({ root, user: "alice", game: "Game1" });
    expect(snapshots).toHaveLength(2);
    expect(snapshots.map((item) => item.manifest.action)).toEqual(["turn", "turn"]);

    const latest = await findLatestSnapshot({ root, user: "alice", game: "Game1" });
    expect(latest?.manifest.snapshotId).toBe(
      formatSnapshotId(new Date("2026-10-22T00:00:01.000Z")),
    );
  });

  it("拒绝路径穿越与非 .json parts", async () => {
    const root = await makeRoot();
    const base = { root, user: "alice", game: "Game1", world: { ok: true } };

    await expect(saveSnapshot({ ...base, user: "../evil" })).rejects.toThrow("user");
    await expect(saveSnapshot({ ...base, game: "Game1/evil" })).rejects.toThrow("game");
    await expect(
      saveSnapshot({ ...base, parts: { "../outside.json": { ok: true } } }),
    ).rejects.toThrow("parts");
    await expect(saveSnapshot({ ...base, parts: { "notes.txt": { ok: true } } })).rejects.toThrow(
      ".json",
    );
  });

  it("重复 snapshotId 失败且不留下临时目录", async () => {
    const root = await makeRoot();
    const input = {
      root,
      user: "alice",
      game: "Game1",
      world: { ok: true },
      snapshotId: "fixed",
    };
    await saveSnapshot(input);
    await expect(saveSnapshot(input)).rejects.toThrow("已存在");

    const entries = await readdir(join(root, "alice", "Game1"));
    expect(entries.filter((name) => name.startsWith("."))).toEqual([]);
    expect(entries).toEqual(["fixed"]);
  });

  it("坏快照在严格读取时失败，但不会阻塞列表", async () => {
    const root = await makeRoot();
    const saved = await saveSnapshot({ root, user: "alice", game: "Game1", world: {} });
    await rm(join(saved.path, "manifest.json"));

    await expect(loadSnapshot(saved.path)).rejects.toThrow();
    await expect(listSnapshots({ root })).resolves.toEqual([]);
  });

  it("快照 ID 使用可排序的本地时间戳", () => {
    const id = formatSnapshotId(new Date(2026, 9, 22, 12, 34, 56, 789));
    expect(id).toBe("2026-10-22_12-34-56-789");
  });
});
