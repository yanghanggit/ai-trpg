import { describe, expect, it } from "vitest";
import {
  addIntent,
  buildInteractTool,
  describeItems,
  describeStats,
  intentClass,
  parseCommunication,
  parseInteract,
  parseMovement,
} from "../src/game/plan";
import { USE_ITEM_SKILL } from "../src/game/skills";
import type { ActorPlan } from "../src/game/types";

describe("actor plan intents", () => {
  it("exposes interact as a top-level peer of communication and movement", () => {
    const tool = buildInteractTool(
      [USE_ITEM_SKILL],
      ["提灯修士"],
      ["裂齿短刃"],
      "断钟中殿",
      "守烬人",
    );

    expect(tool.function.name).toBe("interact");
    expect(tool.function.parameters.required).toEqual(["skill", "purpose"]);
    expect(tool.function.parameters.properties).toMatchObject({
      skill: { enum: ["use_item"] },
      purpose: { enum: ["damage", "use"] },
    });
    expect(
      intentClass({
        kind: "interact",
        skill: USE_ITEM_SKILL,
        itemNames: [],
        purpose: { kind: "damage", targetActorName: "提灯修士" },
      }),
    ).toBe("interact");
    expect(intentClass({ kind: "movement", mode: "wait" })).toBe("movement");
    expect(
      intentClass({ kind: "communication", mind: "说。", mode: "announce", message: "喂" }),
    ).toBe("communication");
  });

  it("allows one communication and one action, then rejects duplicate slots", () => {
    const plan: ActorPlan = { intents: [] };

    addIntent(
      plan,
      parseCommunication({
        mind: "先开口。",
        mode: "say",
        targetActorName: "提灯修士",
        message: "你听见了吗？",
      }),
    );
    addIntent(plan, parseMovement({ mode: "move", targetStageName: "断钟中殿" }));

    expect(plan.intents).toHaveLength(2);
    expect(() =>
      addIntent(
        plan,
        parseCommunication({ mind: "再说一句。", mode: "announce", message: "有人吗？" }),
      ),
    ).toThrow("沟通行动");
    expect(() => addIntent(plan, parseMovement({ mode: "wait" }))).toThrow("移动或交互行动");
  });

  it("treats an interaction as the action-slot peer of movement", () => {
    const plan: ActorPlan = { intents: [] };

    addIntent(
      plan,
      parseCommunication({
        mind: "先让他分心。",
        mode: "announce",
        message: "看那边。",
      }),
    );
    addIntent(
      plan,
      parseInteract(
        {
          skill: "use_item",
          purpose: "damage",
          targetActorName: "提灯修士",
          itemNames: [],
        },
        [USE_ITEM_SKILL],
      ),
    );

    expect(plan.intents[1]).toMatchObject({
      kind: "interact",
      skill: USE_ITEM_SKILL,
      itemNames: [],
      purpose: { kind: "damage", targetActorName: "提灯修士" },
    });
    expect(() => addIntent(plan, parseMovement({ mode: "wait" }))).toThrow("移动或交互行动");
    expect(() =>
      parseInteract({ skill: "use_item", purpose: "damage", targetActorName: "  " }, [
        USE_ITEM_SKILL,
      ]),
    ).toThrow("targetActorName");
    expect(() =>
      parseInteract({ skill: "steal", purpose: "damage", targetActorName: "提灯修士" }, [
        USE_ITEM_SKILL,
      ]),
    ).toThrow("未掌握技能");
  });

  it("renders own stats and items for the read-only tools", () => {
    const actor = {
      id: "actor-1",
      name: "守烬人",
      profile: "拾荒者",
      appearance: "披着旧斗篷",
      hp: 12,
      maxHp: 12,
      attack: 3,
      defense: 2,
      speed: 4,
      death: false,
      skills: [USE_ITEM_SKILL],
      statusEffects: [],
      items: [
        {
          id: "item-1",
          name: "裂齿短刃",
          description: "刃口崩了三处。",
          kind: "weapon",
          count: 1,
          damage: 3,
          block: 0,
        },
      ],
    };

    expect(describeStats(actor)).toContain("HP：12/12");
    expect(describeStats(actor)).toContain("attack：3");
    expect(describeStats(actor)).toContain("状态：存活");
    expect(describeItems(actor)).toContain("裂齿短刃（weapon，count 1）：刃口崩了三处。");
    expect(describeItems({ items: [] })).toBe("物品：无");
  });
});
