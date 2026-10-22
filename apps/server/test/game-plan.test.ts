import { describe, expect, it } from "vitest";
import { addIntent, parseCommunication, parseMovement } from "../src/game/plan";
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
});
