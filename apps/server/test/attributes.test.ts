import { describe, expect, it } from "vitest";
import { formatForm, isValidForm, resolveAppearance } from "../src/game/agents/appearance/form";
import {
  attackPower,
  effectiveSourcesOf,
  equipmentFinalsOf,
  guardPower,
  strengthToDamage,
} from "../src/game/gameplay";
import { equippedSlotOf, toItemState } from "../src/game/item-state";
import { addStats, EMPTY_STATS, toStats } from "../src/game/kernel/attributes";

const ROW = {
  id: "item-1",
  seq: 1,
  name: "测试物品",
  description: "测试描述",
  count: 1,
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
    // 六个字段都走同一条加法规则；是否参与结算由换算层决定，不靠这里区分。
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

  it("结算期才换算攻击力与格挡，属性本身不落成面板值", () => {
    // 本期换算取相等：力量 1:1 进伤害；格挡只来自装备终值。
    expect(strengthToDamage(7)).toBe(7);
    // 角色自己带 damage / block 也不参与：它们不是角色身上的输入。
    const wearer = {
      stats: { ...EMPTY_STATS, strength: 3, damage: 4, block: 5 },
      equipment: { weapon: "测试短刃" },
      items: [{ name: "测试短刃", stats: { ...EMPTY_STATS, damage: 2 } }],
    };
    expect(attackPower(effectiveSourcesOf(wearer), equipmentFinalsOf(wearer))).toBe(5);
    expect(guardPower(equipmentFinalsOf(wearer))).toBe(0);
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

describe("form", () => {
  const form = formatForm("人类", "皮肤灰白，关节干涩。");

  it("requires the race:description shape", () => {
    expect(formatForm("人类", "皮肤灰白，关节干涩。")).toBe(form);
    expect(isValidForm(form)).toBe(true);
    expect(isValidForm("人类:皮肤灰白")).toBe(true);
    expect(isValidForm("[人类]:皮肤灰白")).toBe(false);
    expect(isValidForm("人类 皮肤灰白")).toBe(false);
    expect(isValidForm("人类: 皮肤灰白")).toBe(false);
  });

  it("prefers explicit appearance and falls back to the form", () => {
    expect(resolveAppearance({ form, appearance: "披着旧斗篷。" })).toBe("披着旧斗篷。");
    expect(resolveAppearance({ form, appearance: "  " })).toBe(form);
    expect(resolveAppearance({ form })).toBe(form);
  });
});
