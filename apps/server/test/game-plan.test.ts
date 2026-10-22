import { describe, expect, it } from "vitest";
import {
  addIntent,
  describeItems,
  describeStats,
  parseAttack,
  parseCommunication,
  parseMovement,
} from "../src/game/plan";
import type { ActorPlan } from "../src/game/types";

describe("actor plan intents", () => {
  it("allows one communication and one action, then rejects duplicate classes", () => {
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
    ).toThrow("沟通类行动");
    expect(() => addIntent(plan, parseMovement({ mode: "wait" }))).toThrow("行动类行动");
  });

  it("treats attack as an action intent and requires a target", () => {
    const plan: ActorPlan = { intents: [] };

    addIntent(
      plan,
      parseCommunication({
        mind: "先让他分心。",
        mode: "announce",
        message: "看那边。",
      }),
    );
    addIntent(plan, parseAttack({ targetActorName: "提灯修士" }));

    expect(plan.intents).toEqual([
      expect.objectContaining({ kind: "communication" }),
      { kind: "attack", targetActorName: "提灯修士" },
    ]);
    expect(() => addIntent(plan, parseMovement({ mode: "wait" }))).toThrow("行动类行动");
    expect(() => parseAttack({ targetActorName: "  " })).toThrow("targetActorName");
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
      items: [
        {
          id: "item-1",
          name: "裂齿短刃",
          description: "刃口崩了三处。",
          kind: "weapon",
        },
      ],
    };

    expect(describeStats(actor)).toContain("HP：12/12");
    expect(describeStats(actor)).toContain("attack：3");
    expect(describeStats(actor)).toContain("状态：存活");
    expect(describeItems(actor)).toContain("裂齿短刃（weapon）：刃口崩了三处。");
    expect(describeItems({ items: [] })).toBe("物品：无");
  });
});
