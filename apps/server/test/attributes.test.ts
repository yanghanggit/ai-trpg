import { describe, expect, it } from "vitest";
import {
  ACTOR_ATTRIBUTE_KEYS,
  ATTRIBUTE_DEFINITIONS,
  attribute,
  ITEM_ATTRIBUTE_KEYS,
  sumAttribute,
} from "../src/game/attributes";
import { formatBaseBody, resolveAppearance } from "../src/game/body";
import { toItemState } from "../src/game/items";

const ROW = {
  id: "item-1",
  name: "测试物品",
  description: "测试描述",
  count: 1,
  effect: { type: "event" },
};

describe("attribute registry", () => {
  it("lists actor and item attributes in one table", () => {
    expect(Object.keys(ATTRIBUTE_DEFINITIONS)).toEqual([
      "hp",
      "maxHp",
      "attack",
      "defense",
      "speed",
      "damage",
      "block",
    ]);
    for (const key of ACTOR_ATTRIBUTE_KEYS) {
      expect(ATTRIBUTE_DEFINITIONS[key].scope).toBe("actor");
    }
    for (const key of ITEM_ATTRIBUTE_KEYS) {
      expect(ATTRIBUTE_DEFINITIONS[key].scope).toBe("item");
    }
  });

  it("defaults missing attributes to zero and sums item stats", () => {
    expect(attribute(undefined, "damage")).toBe(0);
    expect(attribute({}, "block")).toBe(0);
    expect(attribute({ damage: 3 }, "damage")).toBe(3);
    expect(sumAttribute([{ damage: 3 }, { damage: 4, block: 1 }, undefined], "damage")).toBe(7);
    expect(sumAttribute([{ damage: 3 }, { block: 1 }], "block")).toBe(1);
  });
});

describe("item state", () => {
  it("keeps the root minimal and puts combat numbers in stats", () => {
    const item = toItemState({
      ...ROW,
      kind: "weapon",
      stats: { damage: 7, block: 1 },
    });
    expect(item).toMatchObject({
      id: "item-1",
      name: "测试物品",
      description: "测试描述",
      kind: "weapon",
      count: 1,
      stats: { damage: 7, block: 1 },
    });
    expect("damage" in item).toBe(false);
    expect("block" in item).toBe(false);
  });

  it("narrows every registered item kind", () => {
    for (const kind of ["weapon", "equipment", "accessory", "consumable", "valuable"] as const) {
      expect(toItemState({ ...ROW, kind, stats: {} }).kind).toBe(kind);
    }
  });

  it("keeps the bare root free of stats for non-combat items", () => {
    const key = toItemState({ ...ROW, kind: "accessory", stats: {} });
    expect("stats" in key).toBe(false);
    expect("equipped" in key).toBe(false);
    const weapon = toItemState({ ...ROW, kind: "weapon", stats: { damage: 1 } });
    expect("stats" in weapon).toBe(true);
  });
});

describe("base body", () => {
  const baseBody = { race: "人类", description: "皮肤灰白，关节干涩。" };

  it("exports race plus the naked appearance snapshot", () => {
    expect(formatBaseBody(baseBody)).toBe("[人类] 皮肤灰白，关节干涩。");
  });

  it("prefers explicit appearance and falls back to the body for animals", () => {
    expect(resolveAppearance({ baseBody, appearance: "披着旧斗篷。" })).toBe("披着旧斗篷。");
    expect(resolveAppearance({ baseBody, appearance: "  " })).toBe(baseBody.description);
    expect(resolveAppearance({ baseBody })).toBe(baseBody.description);
  });
});
