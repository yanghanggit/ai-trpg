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

  it("rejects actor final values: damage / block are derived, not stored", () => {
    const withActorDamage = {
      ...TEST_WORLD,
      actors: TEST_WORLD.actors.map((actor) =>
        actor.name === "守烬人" ? { ...actor, stats: { ...actor.stats, damage: 3 } } : actor,
      ),
    };
    expect(() => parseWorldContent(withActorDamage)).toThrow(/角色不能自带终值 damage/);

    // 终值只属于道具：同一份数值写在道具上是合法的。
    const withItemBlock = {
      ...TEST_WORLD,
      actors: TEST_WORLD.actors.map((actor) =>
        actor.name === "守烬人"
          ? {
              ...actor,
              inventory: actor.inventory.map((item) =>
                item.name === "旧羊毛斗篷" ? { ...item, stats: { ...item.stats, block: 4 } } : item,
              ),
            }
          : actor,
      ),
    };
    const parsed = parseWorldContent(withItemBlock);
    const keeper = parsed.actors.find((actor) => actor.name === "守烬人");
    expect(keeper?.inventory.find((item) => item.name === "旧羊毛斗篷")?.stats?.block).toBe(4);
  });

  it("keeps use out of declared actions on both sides", () => {
    // 角色侧：use 由身上的道具借出，写进动作会被建局拒掉。
    const actorUse = {
      ...TEST_WORLD,
      actors: TEST_WORLD.actors.map((actor) =>
        actor.name === "守烬人" ? { ...actor, actions: [...actor.actions, "use" as const] } : actor,
      ),
    };
    // 枚举里已经没有 use，建局直接拒绝。
    expect(() => parseWorldContent(actorUse)).toThrow(/Invalid option/);

    // 道具侧同理：能不能用由 affixes.use 决定，写进 actions 就是第二个出处。
    const itemUse = {
      ...TEST_WORLD,
      actors: TEST_WORLD.actors.map((actor) =>
        actor.name === "守烬人"
          ? {
              ...actor,
              inventory: actor.inventory.map((item) =>
                item.name === "裂齿短刃"
                  ? { ...item, actions: [...(item.actions ?? []), "use" as const] }
                  : item,
              ),
            }
          : actor,
      ),
    };
    expect(() => parseWorldContent(itemUse)).toThrow(/由 affixes.use 派生，不要写进 actions/);
  });

  it("requires each world function prompt to carry the world constitution", () => {
    const broken = {
      ...TEST_WORLD,
      functionPrompts: { ...TEST_WORLD.functionPrompts, story: "## 职责\n\n写一段故事。\n" },
    };
    expect(() => parseWorldContent(broken)).toThrow(/世界职能宪法缺少/);
  });

  it("requires every world function to have a prompt", () => {
    const { story: _omitted, ...partial } = TEST_WORLD.functionPrompts;
    expect(() => parseWorldContent({ ...TEST_WORLD, functionPrompts: partial })).toThrow();
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

  it("rejects duplicate actor keys", () => {
    const [first, second, ...rest] = TEST_WORLD.actors;
    if (!first || !second) {
      throw new Error("测试世界缺少 actor");
    }
    const world = {
      ...TEST_WORLD,
      actors: [first, { ...second, key: first.key }, ...rest],
    };
    expect(() => parseWorldContent(world)).toThrow(/重复的 actor key/);
  });

  it("rejects duplicate stage keys", () => {
    const [first, second, ...rest] = TEST_WORLD.stages;
    if (!first || !second) {
      throw new Error("测试世界缺少 stage");
    }
    const world = {
      ...TEST_WORLD,
      stages: [first, { ...second, key: first.key }, ...rest],
    };
    expect(() => parseWorldContent(world)).toThrow(/重复的 stage key/);
  });

  it("rejects an item key reused across scopes", () => {
    const [first, second, ...rest] = TEST_WORLD.actors;
    if (!first || !second) {
      throw new Error("测试世界缺少 actor");
    }
    const world = {
      ...TEST_WORLD,
      actors: [first, { ...second, inventory: [...second.inventory, ...first.inventory] }, ...rest],
    };
    expect(() => parseWorldContent(world)).toThrow(/重复的道具 key/);
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
    expect(() => parseWorldContent(world)).toThrow(/道具名重复/);
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
    // source 只属于材料；别的道具声明它会被拒绝，而不是被静默忽略。
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

  it("requires accessories to declare whether they appear in appearance", () => {
    // 饰品在题材之间的语义不固定：要不要进外观是内容要回答的问题，没有默认值。
    const charm = {
      key: "test-charm",
      name: "测试护符",
      description: "一枚测试用的护符。",
      kind: "accessory" as const,
    };
    const withCharm = (item: Record<string, unknown>) => ({
      ...TEST_WORLD,
      actors: TEST_WORLD.actors.map((actor) =>
        actor.name === "守烬人" ? { ...actor, inventory: [...actor.inventory, item] } : actor,
      ),
    });

    expect(() => parseWorldContent(withCharm(charm))).toThrow(
      /accessory 必须声明 appearsInAppearance/,
    );
    const parsed = parseWorldContent(withCharm({ ...charm, appearsInAppearance: false }));
    expect(
      parsed.actors.flatMap((actor) => actor.inventory).find((item) => item.key === "test-charm")
        ?.appearsInAppearance,
    ).toBe(false);

    // 其它大类不得声明：这个字段只回答饰品的问题。
    expect(() =>
      parseWorldContent({
        ...TEST_WORLD,
        actors: TEST_WORLD.actors.map((actor) =>
          actor.name === "守烬人"
            ? {
                ...actor,
                inventory: actor.inventory.map((item) =>
                  item.kind === "weapon" ? { ...item, appearsInAppearance: true } : item,
                ),
              }
            : actor,
        ),
      }),
    ).toThrow(/只有 accessory 可以声明 appearsInAppearance/);
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

      // 同一角色的 actions 自己也不能重复。
      expect(() =>
        parseWorldContent({
          ...TEST_WORLD,
          actors: TEST_WORLD.actors.map((actor) =>
            actor.name === "守烬人"
              ? { ...actor, actions: [...actor.actions, actor.actions[0]!] }
              : actor,
          ),
        }),
      ).toThrow(/在 actions 里重复声明/);

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

      // 技艺只能带固有动作；武器授予的 strike 由道具借出，不能写进技艺。
      expect(() => parseWorldContent(withSkill([{ ...skill, actions: ["strike"] }]))).toThrow(
        /actions/,
      );
      // 空技艺没有意义。
      expect(() => parseWorldContent(withSkill([{ ...skill, actions: [] }]))).toThrow(/actions/);
    });

    it("lets hide come from a skill or the actor", () => {
      const base = {
        ...TEST_WORLD,
        actors: TEST_WORLD.actors.map((actor) =>
          actor.name === "守烬人"
            ? {
                ...actor,
                actions: actor.actions.filter((kind) => kind !== "hide" && kind !== "reveal"),
              }
            : actor,
        ),
      };
      const withHideSkill = {
        ...base,
        actors: base.actors.map((actor) =>
          actor.name === "守烬人"
            ? {
                ...actor,
                proficiencies: [
                  {
                    key: "ambush",
                    name: "暗伏",
                    description: "从暗处看清，再从盲侧出手。",
                    actions: ["hide"],
                  },
                ],
              }
            : actor,
        ),
      };
      const parsed = parseWorldContent(withHideSkill);
      const keeper = parsed.actors.find((actor) => actor.name === "守烬人");
      expect(keeper?.actions).not.toContain("hide");
      expect(actorInnateActions(keeper!)).toContain("hide");

      // hide 也可以直接写进 actions：天生藏身的怪物不必有技艺。
      const direct = parseWorldContent({
        ...base,
        actors: base.actors.map((actor) =>
          actor.name === "守烬人"
            ? { ...actor, actions: [...actor.actions, "hide" as const] }
            : actor,
        ),
      });
      const directKeeper = direct.actors.find((actor) => actor.name === "守烬人");
      expect(directKeeper?.actions).toContain("hide");
    });

    it("rejects duplicate actions on an item", () => {
      const broken = {
        ...TEST_WORLD,
        actors: TEST_WORLD.actors.map((actor) =>
          actor.name === "守烬人"
            ? {
                ...actor,
                inventory: actor.inventory.map((item) =>
                  item.kind === "weapon"
                    ? { ...item, actions: [...(item.actions ?? []), "strike" as const] }
                    : item,
                ),
              }
            : actor,
        ),
      };
      expect(() => parseWorldContent(broken)).toThrow(/不能重复声明/);
    });

    it("rejects innate actions declared on items", () => {
      // 道具只能携带武器类动作；把 say / use 挂到道具上是另一类写错。
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

    it("keeps the target cap on items that grant actions", () => {
      const broken = {
        ...TEST_WORLD,
        actors: TEST_WORLD.actors.map((actor) =>
          actor.name === "提灯修士"
            ? { ...actor, inventory: actor.inventory.map((item) => ({ ...item, maxTargets: 2 })) }
            : actor,
        ),
      };
      // 上限只属于「授予动作」的道具：不授予动作的东西写目标数没有意义。
      expect(() => parseWorldContent(broken)).toThrow(/maxTargets 只对声明了 actions 的道具成立/);
    });
  });
});
