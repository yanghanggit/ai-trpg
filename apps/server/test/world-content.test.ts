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

  it("rejects a known identity that still declares a name", () => {
    const world = {
      ...TEST_WORLD,
      knownIdentities: [{ observer: "ember-keeper", subject: "lantern-monk", name: "提灯修士" }],
    };
    expect(() => parseWorldContent(world)).toThrow(/不再接受 name/);
  });

  it("rejects names with system markers", () => {
    for (const name of ["@守烬人", "#守烬人", "守烬 人", "角色.守烬人"]) {
      const world = {
        ...TEST_WORLD,
        actors: TEST_WORLD.actors.map((actor, index) => (index === 0 ? { ...actor, name } : actor)),
      };
      expect(() => parseWorldContent(world)).toThrow(/名称不能包含/);
    }
  });

  it("rejects duplicate actor and stage names", () => {
    const world = {
      ...TEST_WORLD,
      actors: TEST_WORLD.actors.map((actor) =>
        actor.name === "提灯修士" ? { ...actor, name: "灰烬门廊" } : actor,
      ),
    };
    expect(() => parseWorldContent(world)).toThrow(/名字重复: 灰烬门廊/);
  });

  it("rejects an environment that names an actor", () => {
    const world = {
      ...TEST_WORLD,
      stages: TEST_WORLD.stages.map((stage, index) =>
        index === 0 ? { ...stage, environment: "守烬人站在灰烬里。" } : stage,
      ),
    };
    expect(() => parseWorldContent(world)).toThrow(/environment 不能包含/);
  });

  it("rejects an environment with a system handle", () => {
    const world = {
      ...TEST_WORLD,
      stages: TEST_WORLD.stages.map((stage, index) =>
        index === 0 ? { ...stage, environment: "@12 站在灰烬里。" } : stage,
      ),
    };
    expect(() => parseWorldContent(world)).toThrow(/系统引用/);
  });

  it("accepts stage anchors and trims their labels", () => {
    const world = {
      ...TEST_WORLD,
      stages: TEST_WORLD.stages.map((stage, index) =>
        index === 0
          ? {
              ...stage,
              anchors: [{ label: "  锁舌  ", description: "  门板内侧的铜锁舌。  " }],
            }
          : stage,
      ),
    };
    const parsed = parseWorldContent(world);
    expect(parsed.stages[0]?.anchors).toEqual([
      { label: "锁舌", description: "门板内侧的铜锁舌。" },
    ]);
  });

  it("rejects anchors that leak actor names or system references", () => {
    for (const label of ["守烬人的门闩", "@门闩", "#12 门闩"]) {
      const world = {
        ...TEST_WORLD,
        stages: TEST_WORLD.stages.map((stage, index) =>
          index === 0 ? { ...stage, anchors: [{ label }] } : stage,
        ),
      };
      expect(() => parseWorldContent(world)).toThrow(/锚点不能包含/);
    }
  });

  it("rejects duplicate anchor labels and anchor payloads", () => {
    const duplicate = {
      ...TEST_WORLD,
      stages: TEST_WORLD.stages.map((stage, index) =>
        index === 0 ? { ...stage, anchors: [{ label: "门闩" }, { label: "门闩" }] } : stage,
      ),
    };
    expect(() => parseWorldContent(duplicate)).toThrow(/锚点标签重复/);

    const withEffect = {
      ...TEST_WORLD,
      stages: TEST_WORLD.stages.map((stage, index) =>
        index === 0
          ? { ...stage, anchors: [{ label: "门闩", effect: { type: "damage" } }] }
          : stage,
      ),
    };
    expect(() => parseWorldContent(withEffect)).toThrow();
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

  it("accepts material items alongside the other kinds", () => {
    const world = {
      ...TEST_WORLD,
      actors: TEST_WORLD.actors.map((actor) =>
        actor.name === "守烬人"
          ? {
              ...actor,
              items: [
                ...actor.items,
                {
                  key: "ash-scrap",
                  name: "灰烬碎片",
                  description: "一撮混着石粉的冷灰。",
                  kind: "material" as const,
                  source: "守烬人",
                  effect: { type: "none" },
                },
              ],
            }
          : actor,
      ),
    };
    const parsed = parseWorldContent(world);
    expect(
      parsed.actors
        .flatMap((actor) => actor.items)
        .some((item) => item.kind === "material" && item.name === "灰烬碎片"),
    ).toBe(true);
    expect(
      parsed.actors.flatMap((actor) => actor.items).find((item) => item.name === "灰烬碎片")
        ?.source,
    ).toBe("守烬人");
    expect(() =>
      parseWorldContent({
        ...world,
        actors: world.actors.map((actor) => ({
          ...actor,
          items: actor.items.map((item) => ({ ...item, kind: "relic" })),
        })),
      }),
    ).toThrow();
    // source 只属于材料；别的物品声明它会被拒绝，而不是被静默忽略。
    expect(() =>
      parseWorldContent({
        ...world,
        actors: world.actors.map((actor) =>
          actor.name === "守烬人"
            ? {
                ...actor,
                items: actor.items.map((item) =>
                  item.kind === "weapon" ? { ...item, source: "守烬人" } : item,
                ),
              }
            : actor,
        ),
      }),
    ).toThrow(/source/);
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
