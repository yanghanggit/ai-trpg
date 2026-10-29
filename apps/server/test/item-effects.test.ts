import { describe, expect, it } from "vitest";
import { EMPTY_STATS } from "../src/game/attributes";
import { applyItemEffect } from "../src/game/item-effects";
import { toItemState } from "../src/game/items";

const ROW = {
  id: "item-1",
  seq: 1,
  name: "测试物品",
  description: "测试描述",
  count: 1,
  stats: EMPTY_STATS,
  effect: { type: "event" },
};

describe("item effects", () => {
  it("keeps the declarative effect and provided actions on the item state", () => {
    expect(toItemState({ ...ROW, kind: "accessory" }).effect).toEqual({ type: "event" });
    const weapon = toItemState({
      ...ROW,
      kind: "weapon",
      effect: { type: "damage" },
      actions: ["strike"],
    });
    expect(weapon.effect).toEqual({ type: "damage" });
    expect(weapon.actions).toEqual(["strike"]);
    // 没声明动作的物品不会凭空借出动作。
    expect(toItemState({ ...ROW, kind: "weapon", effect: { type: "damage" } }).actions).toEqual([]);
  });

  it("routes by effect.type and rejects unknown handlers", async () => {
    await expect(applyItemEffect({ effect: { type: "unknown" } } as never)).rejects.toThrow(
      "没有可以直接使用的效果",
    );
  });
});
