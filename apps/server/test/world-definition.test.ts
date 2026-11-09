import { describe, expect, it } from "vitest";
import { actorInnateActions, parseWorldContent } from "../src/game/world-definition";
import { TEST_WORLD } from "./test-world";

describe("world content validation", () => {
  it("accepts the test world and strips unknown fields", () => {
    const world = parseWorldContent({ ...TEST_WORLD, extra: "ignored" });
    expect(world.worldName).toBe(TEST_WORLD.worldName);
    expect(world.actions).toEqual(["notify_stage", "end_game"]);
    expect("extra" in world).toBe(false);
  });

  it("requires each world function prompt to carry the world constitution", () => {
    const broken = {
      ...TEST_WORLD,
      functionAgents: TEST_WORLD.functionAgents.map((agent) =>
        agent.fn === "story" ? { ...agent, systemPrompt: "## 职责\n\n写一段故事。\n" } : agent,
      ),
    };
    expect(() => parseWorldContent(broken)).toThrow(/世界职能 agent 的宪法缺少/);
  });

  it("requires exactly one agent per world function", () => {
    const broken = {
      ...TEST_WORLD,
      functionAgents: TEST_WORLD.functionAgents.slice(1),
    };
    expect(() => parseWorldContent(broken)).toThrow(/世界职能 agent 必须恰好一个/);
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

  it("accepts an explicit starting signature name", () => {
    const world = {
      ...TEST_WORLD,
      signatureNames: [{ observer: "ember-keeper", subject: "lantern-monk", name: "提灯人" }],
    };
    const parsed = parseWorldContent(world);
    expect(parsed.signatureNames?.[0]).toEqual({
      observer: "ember-keeper",
      subject: "lantern-monk",
      name: "提灯人",
    });
  });

  it("requires an explicit starting signature name", () => {
    const world = {
      ...TEST_WORLD,
      signatureNames: [{ observer: "ember-keeper", subject: "lantern-monk" }],
    };
    expect(() => parseWorldContent(world)).toThrow();
  });

  it("rejects a starting signature name with system markers", () => {
    const world = {
      ...TEST_WORLD,
      signatureNames: [{ observer: "ember-keeper", subject: "lantern-monk", name: "#提灯人" }],
    };
    expect(() => parseWorldContent(world)).toThrow(/名字不能包含/);
  });

  it("rejects names with system markers", () => {
    for (const name of ["#守烬人", "守烬 人", "角色.守烬人"]) {
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

  it("rejects duplicate item names within one scope", () => {
    const world = {
      ...TEST_WORLD,
      actors: TEST_WORLD.actors.map((actor, index) =>
        index === 0 ? { ...actor, inventory: [...actor.inventory, ...actor.inventory] } : actor,
      ),
    };
    expect(() => parseWorldContent(world)).toThrow(/物品名重复/);
  });

  it("rejects an environment with a system handle", () => {
    const world = {
      ...TEST_WORLD,
      stages: TEST_WORLD.stages.map((stage, index) =>
        index === 0 ? { ...stage, environment: "#12 站在灰烬里。" } : stage,
      ),
    };
    expect(() => parseWorldContent(world)).toThrow(/编号引用/);
  });

  it("accepts stage anchors and trims their labels", () => {
    const world = {
      ...TEST_WORLD,
      stages: TEST_WORLD.stages.map((stage, index) =>
        index === 0
          ? {
              ...stage,
              anchors: [{ key: "latch", label: "  锁舌  ", description: "  门板内侧的铜锁舌。  " }],
            }
          : stage,
      ),
    };
    const parsed = parseWorldContent(world);
    expect(parsed.stages[0]?.anchors).toEqual([
      { key: "latch", label: "锁舌", description: "门板内侧的铜锁舌。" },
    ]);
  });

  it("rejects anchors that leak actor names or system references", () => {
    for (const label of ["守烬人的门闩", "#12 门闩"]) {
      const world = {
        ...TEST_WORLD,
        stages: TEST_WORLD.stages.map((stage, index) =>
          index === 0 ? { ...stage, anchors: [{ key: "latch", label }] } : stage,
        ),
      };
      expect(() => parseWorldContent(world)).toThrow(/锚点不能包含/);
    }
  });

  it("rejects duplicate anchor labels and anchor payloads", () => {
    const duplicate = {
      ...TEST_WORLD,
      stages: TEST_WORLD.stages.map((stage, index) =>
        index === 0
          ? {
              ...stage,
              anchors: [
                { key: "latch", label: "门闩" },
                { key: "other", label: "门闩" },
              ],
            }
          : stage,
      ),
    };
    expect(() => parseWorldContent(duplicate)).toThrow(/锚点标签重复/);

    const withUnknownAnchorField = {
      ...TEST_WORLD,
      stages: TEST_WORLD.stages.map((stage, index) =>
        index === 0
          ? {
              ...stage,
              anchors: [{ key: "latch", label: "门闩", unknownField: { type: "damage" } }],
            }
          : stage,
      ),
    };
    expect(() => parseWorldContent(withUnknownAnchorField)).toThrow();
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

  it("keeps declarative item affixes and rejects invalid static ops", () => {
    const strikeAffix = {
      name: "裂齿",
      content: "造成 {{attack}} 点伤害",
      ops: [{ kind: "damage" as const, amount: { ref: "attack" as const } }],
    };
    const world = {
      ...TEST_WORLD,
      actors: TEST_WORLD.actors.map((actor) =>
        actor.name === "守烬人"
          ? {
              ...actor,
              inventory: [{ ...actor.inventory[0], affixes: { strike: [strikeAffix] } }],
            }
          : actor,
      ),
    };
    const parsedKeeper = parseWorldContent(world).actors.find((actor) => actor.name === "守烬人");
    expect(parsedKeeper?.inventory[0]?.affixes?.strike?.[0]?.ops).toEqual(strikeAffix.ops);

    expect(() =>
      parseWorldContent({
        ...world,
        actors: world.actors.map((actor) => ({
          ...actor,
          inventory: [
            {
              ...actor.inventory[0],
              affixes: { strike: [{ ...strikeAffix, ops: [] }] },
            },
          ],
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
              inventory: [
                ...actor.inventory,
                {
                  key: "ash-scrap",
                  name: "灰烬碎片",
                  description: "一撮混着石粉的冷灰。",
                  kind: "material" as const,
                  source: "守烬人",
                },
              ],
            }
          : actor,
      ),
    };
    const parsed = parseWorldContent(world);
    expect(
      parsed.actors
        .flatMap((actor) => actor.inventory)
        .some((item) => item.kind === "material" && item.name === "灰烬碎片"),
    ).toBe(true);
    expect(
      parsed.actors.flatMap((actor) => actor.inventory).find((item) => item.name === "灰烬碎片")
        ?.source,
    ).toBe("守烬人");
    expect(() =>
      parseWorldContent({
        ...world,
        actors: world.actors.map((actor) => ({
          ...actor,
          inventory: actor.inventory.map((item) => ({ ...item, kind: "relic" })),
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
                inventory: actor.inventory.map((item) =>
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
        actor.name === "守烬人"
          ? { ...actor, inventory: [{ ...actor.inventory[0], key: "" }] }
          : actor,
      ),
    };
    expect(() => parseWorldContent(world)).toThrow();
  });

  describe("action sources", () => {
    it("rejects carried actions declared as innate", () => {
      // 武器授予的动作不能写进角色：内容层就该拒绝，而不是等回合里发现没有武器。
      for (const kind of ["strike", "cleave"]) {
        const broken = {
          ...TEST_WORLD,
          actors: TEST_WORLD.actors.map((actor) =>
            actor.name === "守烬人" ? { ...actor, actions: [...actor.actions, kind] } : actor,
          ),
        };
        expect(() => parseWorldContent(broken)).toThrow(/actions/);
      }
    });

    it("turns skills into actor actions and keeps one owner per action", () => {
      const withSkill = (skills: unknown[] | undefined) => ({
        ...TEST_WORLD,
        actors: TEST_WORLD.actors.map((actor) =>
          actor.name === "守烬人"
            ? {
                ...actor,
                actions: actor.actions.filter((kind) => kind !== "steal"),
                proficiencies: skills,
              }
            : actor,
        ),
      });
      const skill = {
        key: "pickpocket",
        name: "探囊",
        description: "先看清，再取走。",
        actions: ["inspect", "steal"],
      };
      const parsed = parseWorldContent(withSkill([skill]));
      const keeper = parsed.actors.find((actor) => actor.name === "守烬人");
      expect(keeper?.proficiencies?.[0]?.name).toBe("探囊");
      // 物化由 `actorInnateActions` 负责：定义侧的动作列表不重复写技艺给的动作。
      if (!keeper) {
        throw new Error("解析结果缺少守烬人");
      }
      expect(actorInnateActions(keeper)).toEqual(expect.arrayContaining(["inspect", "steal"]));

      // 一个动作只能有一个出处：既在 actions 里又被技艺带一遍，是重复声明。
      const duplicated = {
        ...TEST_WORLD,
        actors: TEST_WORLD.actors.map((actor) =>
          actor.name === "守烬人"
            ? { ...actor, actions: [...actor.actions, "steal" as const] }
            : actor,
        ),
      };
      expect(() => parseWorldContent(duplicated)).toThrow(/已经有来源/);

      // 两项技艺不能带同一个动作，key 也不能在同一角色下重复。
      expect(() =>
        parseWorldContent(
          withSkill([
            { key: "a", name: "甲", description: "一。", actions: ["inspect"] },
            { key: "b", name: "乙", description: "二。", actions: ["inspect"] },
          ]),
        ),
      ).toThrow(/已经有来源/);
      expect(() =>
        parseWorldContent(
          withSkill([
            skill,
            { key: "pickpocket", name: "另一手", description: "重名。", actions: ["give"] },
          ]),
        ),
      ).toThrow(/技艺 key 重复/);

      // 技艺只能带固有动作；武器授予的 strike 由物品借出，不能写进技艺。
      expect(() => parseWorldContent(withSkill([{ ...skill, actions: ["strike"] }]))).toThrow(
        /actions/,
      );
      // 空技艺没有意义。
      expect(() => parseWorldContent(withSkill([{ ...skill, actions: [] }]))).toThrow(/actions/);
    });

    it("rejects innate actions declared on items", () => {
      // 物品只能携带武器类动作；把 say / use 挂到物品上是另一类写错。
      const broken = {
        ...TEST_WORLD,
        actors: TEST_WORLD.actors.map((actor) =>
          actor.name === "守烬人"
            ? {
                ...actor,
                inventory: actor.inventory.map((item) =>
                  item.kind === "weapon" ? { ...item, actions: ["strike", "say"] } : item,
                ),
              }
            : actor,
        ),
      };
      expect(() => parseWorldContent(broken)).toThrow(/actions/);
    });
  });

  describe("cleave target cap", () => {
    /** 横扫自己的词缀：与挥击各声明一套，互不借用。 */
    const CLEAVE_AFFIX = [
      {
        name: "横扫",
        content: "刀锋横过",
        ops: [{ kind: "damage" as const, amount: 2 }],
      },
    ];

    /** 守住门廊那把短刃：属性可直接打补丁，别处不动。 */
    const withBlade = (patch: Record<string, unknown>) => ({
      ...TEST_WORLD,
      actors: TEST_WORLD.actors.map((actor) =>
        actor.name === "守烬人"
          ? {
              ...actor,
              inventory: actor.inventory.map((item) =>
                item.key === "cracked-blade" ? { ...item, ...patch } : item,
              ),
            }
          : actor,
      ),
    });

    const withCleave = (patch: Record<string, unknown>) => {
      const blade = withBlade(patch);
      return {
        ...blade,
        actors: blade.actors.map((actor) =>
          actor.name === "守烬人"
            ? {
                ...actor,
                inventory: actor.inventory.map((item) =>
                  item.key === "cracked-blade"
                    ? { ...item, affixes: { ...item.affixes, cleave: CLEAVE_AFFIX } }
                    : item,
                ),
              }
            : actor,
        ),
      };
    };

    it("accepts cleave together with affixes.cleave and a target cap", () => {
      const world = parseWorldContent(withCleave({ actions: ["strike", "cleave"], maxTargets: 3 }));
      const blade = world.actors
        .flatMap((actor) => actor.inventory)
        .find((item) => item.key === "cracked-blade");
      expect(blade?.actions).toEqual(["strike", "cleave"]);
      expect(blade?.maxTargets).toBe(3);
      expect(blade?.affixes?.cleave?.[0]?.name).toBe("横扫");
    });

    it("requires a cap of at least two for cleave", () => {
      expect(() => parseWorldContent(withCleave({ actions: ["strike", "cleave"] }))).toThrow(
        /maxTargets/,
      );
      expect(() =>
        parseWorldContent(withCleave({ actions: ["strike", "cleave"], maxTargets: 1 })),
      ).toThrow(/maxTargets/);
    });

    it("requires cleave and maxTargets to justify each other", () => {
      // 没有 cleave 却写多目标上限：内容是写错了，不是留个伏笔。
      expect(() => parseWorldContent(withCleave({ maxTargets: 3 }))).toThrow(/maxTargets/);
      // 横扫不借用挥击词缀：没有 affixes.cleave 就没有伤害来源。
      expect(() =>
        parseWorldContent(withBlade({ actions: ["strike", "cleave"], maxTargets: 2 })),
      ).toThrow(/affixes.cleave/);
    });

    it("keeps the target cap on weapons", () => {
      const broken = {
        ...TEST_WORLD,
        actors: TEST_WORLD.actors.map((actor) =>
          actor.name === "提灯修士"
            ? { ...actor, inventory: actor.inventory.map((item) => ({ ...item, maxTargets: 2 })) }
            : actor,
        ),
      };
      expect(() => parseWorldContent(broken)).toThrow(/只有 weapon 可以声明 maxTargets/);
    });
  });
});
