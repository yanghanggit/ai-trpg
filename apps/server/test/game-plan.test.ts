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
import type { ActorPlan } from "../src/game/types";

describe("actor plan intents", () => {
  it("exposes interact as a top-level peer of communication and movement", () => {
    const tool = buildInteractTool(["提灯修士"], ["裂齿短刃"], "断钟中殿", "守烬人");

    expect(tool.function.name).toBe("interact");
    expect(tool.function.parameters.required).toEqual(["purpose"]);
    expect(tool.function.parameters.properties).toMatchObject({
      purpose: { enum: ["damage", "steal", "give", "pickup", "use"] },
    });
    expect(
      intentClass({
        kind: "interact",
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
      parseInteract({
        purpose: "damage",
        targetActorName: "提灯修士",
        itemNames: [],
      }),
    );

    expect(plan.intents[1]).toMatchObject({
      kind: "interact",
      itemNames: [],
      purpose: { kind: "damage", targetActorName: "提灯修士" },
    });
    expect(() => addIntent(plan, parseMovement({ mode: "wait" }))).toThrow("移动或交互行动");
    expect(() => parseInteract({ purpose: "damage", targetActorName: "  " })).toThrow(
      "targetActorName",
    );
  });

  it("parses every interact branch", () => {
    expect(
      parseInteract({ purpose: "damage", targetActorName: "提灯修士", itemNames: ["裂齿短刃"] }),
    ).toEqual({
      kind: "interact",
      itemNames: ["裂齿短刃"],
      purpose: { kind: "damage", targetActorName: "提灯修士" },
    });
    expect(
      parseInteract({ purpose: "steal", targetActorName: "提灯修士", itemName: "铅封提灯" }),
    ).toMatchObject({ purpose: { kind: "steal", itemName: "铅封提灯" } });
    expect(parseInteract({ purpose: "pickup", itemName: "武器.测试火把" })).toMatchObject({
      purpose: { kind: "pickup" },
    });
    expect(
      parseInteract({
        purpose: "use",
        itemName: "饰品.封骨钥匙",
        targetStageName: "场景.封骨之门",
      }),
    ).toMatchObject({ purpose: { kind: "use" } });
    expect(() => parseInteract({ purpose: "dance" })).toThrow("不支持交互分支");
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
