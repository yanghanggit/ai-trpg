import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  dumpSystemPrompts,
  PROMPTS_DIR_ENV,
  promptsRoot,
  safeFileName,
  timestampName,
  worldPromptMarkdown,
} from "../src/debug/prompt-dump";

const input = {
  world: {
    name: "枯钟修道院",
    contentVersion: "test.v1",
    campaignSetting: "世界设定正文。",
    systemRules: "全局规则正文。",
  },
  actorPrompts: [{ name: "奥德里克", prompt: "ACTOR PROMPT" }],
  stagePrompts: [{ name: "灰烬门廊", prompt: "STAGE PROMPT" }],
};

describe("prompt dump", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "ai-trpg-prompts-"));
  });

  afterAll(async () => {
    delete process.env[PROMPTS_DIR_ENV];
    await rm(root, { recursive: true, force: true });
  });

  it("writes world/actor/stage prompts into a timestamped container", async () => {
    process.env[PROMPTS_DIR_ENV] = root;
    const dir = await dumpSystemPrompts(input, { now: new Date("2026-10-23T12:34:56") });

    expect(dir).toBe(join(root, "20261023_123456_枯钟修道院"));
    expect(await readFile(join(dir as string, "world.md"), "utf8")).toContain("# 枯钟修道院");
    expect(await readFile(join(dir as string, "actors", "奥德里克.md"), "utf8")).toContain(
      "ACTOR PROMPT",
    );
    expect(await readFile(join(dir as string, "stages", "灰烬门廊.md"), "utf8")).toContain(
      "STAGE PROMPT",
    );
  });

  it("keeps two games created in the same second apart", async () => {
    process.env[PROMPTS_DIR_ENV] = root;
    const now = new Date("2026-10-23T12:34:57");
    const first = await dumpSystemPrompts(input, { now });
    const second = await dumpSystemPrompts(input, { now });
    expect(first).not.toBe(second);
    expect(second?.startsWith(first as string)).toBe(true);
    expect(second).not.toBe(first);
  });

  it("skips dumping in tests unless PROMPTS_DIR is set", async () => {
    delete process.env[PROMPTS_DIR_ENV];
    expect(await dumpSystemPrompts(input)).toBeNull();
  });

  it("sanitizes names and renders the world prompt", () => {
    expect(safeFileName("场景/奥德里克 的墓园")).toBe("场景_奥德里克_的墓园");
    expect(safeFileName("")).toBe("unnamed");
    expect(timestampName(new Date("2026-01-02T03:04:05"))).toBe("20260102_030405");
    const markdown = worldPromptMarkdown(input.world);
    expect(markdown).toContain("## 游戏设定\n\n世界设定正文。");
    expect(markdown).toContain("## 全局规则\n\n全局规则正文。");
    expect(promptsRoot(root)).toBe(root);
  });
});
