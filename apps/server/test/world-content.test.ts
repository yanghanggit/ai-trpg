import { describe, expect, it } from "vitest";
import { parseWorldContent } from "../src/game/world-content";
import { TEST_WORLD } from "./test-world";

describe("world content validation", () => {
  it("accepts the test world and strips unknown fields", () => {
    const world = parseWorldContent({ ...TEST_WORLD, extra: "ignored" });
    expect(world.worldName).toBe(TEST_WORLD.worldName);
    expect(world.actions).toEqual(["notify_stage", "end_game"]);
    expect("extra" in world).toBe(false);
  });

  it("rejects a world without explicit capabilities", () => {
    const { actions: _actions, ...withoutActions } = TEST_WORLD;
    expect(() => parseWorldContent(withoutActions)).toThrow();
  });

  it("rejects an item without a stable key", () => {
    const world = {
      ...TEST_WORLD,
      actors: TEST_WORLD.actors.map((actor) =>
        actor.name === "守烬人" ? { ...actor, items: [{ ...actor.items[0], key: "" }] } : actor,
      ),
    };
    expect(() => parseWorldContent(world)).toThrow();
  });
});
