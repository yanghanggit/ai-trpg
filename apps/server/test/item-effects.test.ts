import { describe, expect, it } from "vitest";
import { EMPTY_STATS } from "../src/game/attributes";
import { applyItemEffect, UNARMED_EFFECT } from "../src/game/item-effects";
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
  it("keeps the declarative effect on the item state", () => {
    expect(toItemState({ ...ROW, kind: "accessory" }).effect).toEqual({ type: "event" });
    expect(toItemState({ ...ROW, kind: "weapon", effect: { type: "damage" } }).effect).toEqual({
      type: "damage",
    });
    expect(UNARMED_EFFECT).toEqual({ type: "damage" });
  });

  it("routes by effect.type and rejects unknown handlers", async () => {
    await expect(applyItemEffect({ effect: { type: "unknown" } } as never)).rejects.toThrow(
      "没有可以直接使用的效果",
    );
  });
});
