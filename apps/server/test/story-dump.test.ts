import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dumpStory } from "../src/debug/story-dump";

describe("story dump", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true });
      root = undefined;
    }
  });

  it("writes a timestamped markdown story with metadata and avoids overwriting", async () => {
    root = await mkdtemp(join(tmpdir(), "ai-trpg-stories-"));
    const input = {
      gameName: "主角死亡故事 E2E",
      gameSlug: "player-death-story-e2e",
      gameStatus: "completed",
      contentVersion: "dark-fantasy.v11",
      version: 4,
      story: "奥德里克把无名者击倒在墓园里。",
      rounds: 5,
      memoriesRead: ["world:枯钟修道院", "actor:角色.奥德里克"],
      eventsRead: true,
      now: new Date("2026-01-02T03:04:05"),
    };

    const path = await dumpStory(input, { root });
    expect(path).toContain("20260102_030405_player-death-story-e2e.md");
    const content = await readFile(path, "utf8");
    expect(content).toContain("# 主角死亡故事 E2E · 故事总结");
    expect(content).toContain("- slug: player-death-story-e2e");
    expect(content).toContain("- 状态: completed");
    expect(content).toContain("读取记忆: 2");
    expect(content).toContain("奥德里克把无名者击倒在墓园里。");

    const second = await dumpStory(input, { root });
    expect(second).not.toBe(path);
    expect(second).toContain("_2.md");
  });
});
