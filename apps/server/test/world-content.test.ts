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

  it("accepts an optional opening briefing without changing the actor profile", () => {
    const world = parseWorldContent({
      ...TEST_WORLD,
      actors: TEST_WORLD.actors.map((actor) =>
        actor.name === "守烬人"
          ? { ...actor, openingBriefing: "先守住门廊，再看清来人的手。" }
          : actor,
      ),
    });
    const keeper = world.actors.find((actor) => actor.name === "守烬人");
    expect(keeper?.openingBriefing).toBe("先守住门廊，再看清来人的手。");
    expect(keeper?.profile).toBe(TEST_WORLD.actors[0]?.profile);
  });

  it("requires every stage to expose environment updates", () => {
    const world = {
      ...TEST_WORLD,
      stages: TEST_WORLD.stages.map((stage, index) =>
        index === 0 ? { ...stage, actions: ["notify_world"] } : stage,
      ),
    };
    expect(() => parseWorldContent(world)).toThrow(/submit_environment/);
  });

  it("rejects a world without explicit capabilities", () => {
    const { actions: _actions, ...withoutActions } = TEST_WORLD;
    expect(() => parseWorldContent(withoutActions)).toThrow();
  });

  it("keeps the declarative item effect and requires a handler type", () => {
    const world = {
      ...TEST_WORLD,
      actors: TEST_WORLD.actors.map((actor) =>
        actor.name === "守烬人"
          ? {
              ...actor,
              items: [{ ...actor.items[0], effect: { type: "damage" } }],
            }
          : actor,
      ),
    };
    const parsedKeeper = parseWorldContent(world).actors.find((actor) => actor.name === "守烬人");
    expect(parsedKeeper?.items[0]?.effect).toEqual({ type: "damage" });

    expect(() =>
      parseWorldContent({
        ...world,
        actors: world.actors.map((actor) => ({
          ...actor,
          items: [{ ...actor.items[0], effect: { type: "" } }],
        })),
      }),
    ).toThrow();
  });

  it("requires the world to describe itself", () => {
    const { profile: _profile, ...withoutProfile } = TEST_WORLD;
    expect(() => parseWorldContent(withoutProfile)).toThrow(/profile/);
    expect(() => parseWorldContent({ ...TEST_WORLD, profile: "" })).toThrow(/profile/);
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
