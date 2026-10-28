import { describe, expect, it } from "vitest";
import { addStats, EMPTY_STATS, toStats } from "../src/game/attributes";
import { formatBaseBody, resolveAppearance } from "../src/game/body";
import { equippedSlotOf, toItemState } from "../src/game/items";

const ROW = {
  id: "item-1",
  seq: 1,
  name: "测试物品",
  description: "测试描述",
  count: 1,
  effect: { type: "event" },
};

describe("stats", () => {
  it("归一化：缺失字段补 0，多余的旧字段被丢弃", () => {
    expect(toStats(undefined)).toEqual(EMPTY_STATS);
    expect(toStats({ damage: 7 })).toEqual({ ...EMPTY_STATS, damage: 7 });
    // 旧数据里可能有已移出 Stats 的 hp，归一化后不应保留。
    const legacy = { maxHp: 10, hp: 3 } as unknown as Partial<typeof EMPTY_STATS>;
    expect(toStats(legacy)).toEqual({ ...EMPTY_STATS, maxHp: 10 });
  });

  it("逐字段相加：装备加成与本体属性走同一条规则", () => {
    // strength / wisdom / agility 也走同一条加法规则，虽然当前没有结算读取它们。
    expect(addStats({ strength: 5 }, { damage: 3 }, undefined)).toEqual({
      ...EMPTY_STATS,
      strength: 5,
      damage: 3,
    });
    expect(addStats({ maxHp: 10, wisdom: 2 }, { maxHp: 4 }, { block: 1, agility: 3 })).toEqual({
      ...EMPTY_STATS,
      maxHp: 14,
      wisdom: 2,
      agility: 3,
      block: 1,
    });
    expect(addStats()).toEqual(EMPTY_STATS);
  });
});

describe("item state", () => {
  it("所有物品都携带归一化后的完整属性", () => {
    const item = toItemState({
      ...ROW,
      kind: "weapon",
      stats: toStats({ damage: 7, block: 1 }),
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
      expect(toItemState({ ...ROW, kind, stats: EMPTY_STATS }).kind).toBe(kind);
    }
  });

  it("非战斗物品同样有 stats，只是全为 0", () => {
    const key = toItemState({ ...ROW, kind: "accessory", stats: toStats(undefined) });
    expect(key.stats).toEqual(EMPTY_STATS);
    expect("equipped" in key).toBe(false);
  });
});

describe("equipment index", () => {
  it("按物品名定位槽位，没穿戴时没有槽位", () => {
    expect(equippedSlotOf({ weapon: "裂齿短刃", armor: "旧斗篷" }, "裂齿短刃")).toBe("weapon");
    expect(equippedSlotOf({ weapon: "裂齿短刃" }, "旧斗篷")).toBeUndefined();
    expect(equippedSlotOf({}, "裂齿短刃")).toBeUndefined();
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
