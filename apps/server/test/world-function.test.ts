import { describe, expect, it } from "vitest";
import type { WorldState } from "../src/game/kernel/types";
import { worldFunctionPrompt } from "../src/game/world-function";
import { TEST_WORLD } from "./test-world";

/**
 * 职能宪法可以按记忆主体细分：内容层写了 `compact.actor` 就用它，没写就回落到 `compact`。
 * 调用方不需要知道这次到底用了哪一份。
 */
function worldWith(extra: Record<string, string>): WorldState {
  return {
    ...TEST_WORLD,
    name: TEST_WORLD.worldName,
    functionPrompts: { ...TEST_WORLD.functionPrompts, ...extra },
  } as unknown as WorldState;
}

describe("world function prompt", () => {
  it("falls back to the shared constitution when no variant is defined", () => {
    const world = worldWith({});

    expect(worldFunctionPrompt(world, "compact", "actor")).toBe(TEST_WORLD.functionPrompts.compact);
    expect(worldFunctionPrompt(world, "compact")).toBe(TEST_WORLD.functionPrompts.compact);
  });

  it("prefers the per-owner variant only for that owner", () => {
    const world = worldWith({ "compact.actor": "演员专属压缩口径" });

    expect(worldFunctionPrompt(world, "compact", "actor")).toBe("演员专属压缩口径");
    expect(worldFunctionPrompt(world, "compact", "stage")).toBe(TEST_WORLD.functionPrompts.compact);
    expect(worldFunctionPrompt(world, "compact", "world")).toBe(TEST_WORLD.functionPrompts.compact);
  });

  it("only compacts have variants; other functions ignore the owner", () => {
    const world = worldWith({});

    expect(worldFunctionPrompt(world, "story", "actor")).toBe(TEST_WORLD.functionPrompts.story);
  });

  it("refuses empty constitutions instead of streaming an empty prompt", () => {
    // 键存在但内容是空白 = 内容层写坏了，不回落、不静默：schema 也会拒绝这种内容。
    const blankVariant = worldWith({ "compact.actor": "   " });
    expect(() => worldFunctionPrompt(blankVariant, "compact", "actor")).toThrow(/缺少世界职能宪法/);

    const blankBase = worldWith({ compact: "  " });
    expect(() => worldFunctionPrompt(blankBase, "compact", "actor")).toThrow(/缺少世界职能宪法/);
  });
});
