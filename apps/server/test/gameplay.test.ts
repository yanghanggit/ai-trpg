import { describe, expect, it } from "vitest";
import {
  actorDamage,
  attackPower,
  awarenessRuleText,
  effectiveSourcesOf,
  equipmentFinalsOf,
  GAMEPLAY_RULES,
  type GameplayRules,
  guardPower,
  inspectNoticed,
  mitigatedDamage,
  stealOutcome,
  strengthToDamage,
  unarmedAttackPower,
} from "../src/game/gameplay";
import { EMPTY_STATS, type Stats } from "../src/game/kernel/attributes";

/** 只改一条开关，其余沿用默认；用来断言「关掉后会变成什么」。 */
const withRules = (rules: Partial<GameplayRules>): GameplayRules => ({
  ...GAMEPLAY_RULES,
  ...rules,
});

const STRENGTH_OFF = withRules({ strengthAddsToAttack: false });
const AWARENESS_OFF = withRules({ agilityGovernsAwareness: false });

const item = (name: string, stats: Partial<Stats>) => ({
  name,
  stats: { ...EMPTY_STATS, ...stats },
});

/** 一件在穿的武器 + 一件在穿的护甲，外加一件背包里的道具。 */
const wearer = {
  stats: { ...EMPTY_STATS, maxHp: 12, strength: 3, agility: 4 },
  equipment: { weapon: "短刃", armor: "铆钉甲" },
  items: [
    item("短刃", { damage: 2 }),
    item("铆钉甲", { block: 3, agility: 1 }),
    item("背包里的火把", { damage: 8 }),
  ],
};

describe("gameplay rules", () => {
  it("默认两条玩法规则都开着", () => {
    expect(GAMEPLAY_RULES).toEqual({
      strengthAddsToAttack: true,
      agilityGovernsAwareness: true,
    });
  });
});

describe("combat conversions", () => {
  it("力量 1:1 换算成角色顺时的 damage，可整条关掉", () => {
    expect(strengthToDamage(7)).toBe(7);
    expect(strengthToDamage(7, STRENGTH_OFF)).toBe(0);
    expect(actorDamage({ ...EMPTY_STATS, strength: 3 }, GAMEPLAY_RULES)).toBe(3);
    expect(actorDamage({ ...EMPTY_STATS, strength: 3 }, STRENGTH_OFF)).toBe(0);
    expect(actorDamage({ ...EMPTY_STATS, damage: 9 }, GAMEPLAY_RULES)).toBe(0);
  });

  it("攻击力 = 源属性现算 + 装备终值；角色自身带的 damage 不算数", () => {
    expect(attackPower({ ...EMPTY_STATS, strength: 3 }, { ...EMPTY_STATS, damage: 2 })).toBe(5);
    expect(attackPower({ ...EMPTY_STATS, damage: 9 }, { ...EMPTY_STATS, damage: 2 })).toBe(2);
    expect(
      attackPower({ ...EMPTY_STATS, strength: 3 }, { ...EMPTY_STATS, damage: 2 }, STRENGTH_OFF),
    ).toBe(2);
  });

  it("格挡只来自装备终值，角色自身的 block 不算数", () => {
    expect(guardPower({ ...EMPTY_STATS, block: 5 })).toBe(5);
    expect(guardPower({ ...EMPTY_STATS })).toBe(0);
  });

  it("肉搏只吃源属性，不吃装备终值", () => {
    expect(unarmedAttackPower({ ...EMPTY_STATS, strength: 2 }, GAMEPLAY_RULES)).toBe(2);
    expect(unarmedAttackPower({ ...EMPTY_STATS, damage: 9 }, GAMEPLAY_RULES)).toBe(0);
  });

  it("减伤只在 0 处截断", () => {
    expect(mitigatedDamage(10, 5)).toBe(5);
    expect(mitigatedDamage(3, 5)).toBe(0);
  });
});

describe("source and final collection", () => {
  it("源属性现值只并穿戴中道具的源属性，终值与背包道具不进来", () => {
    expect(effectiveSourcesOf(wearer)).toEqual({
      ...EMPTY_STATS,
      maxHp: 12,
      strength: 3,
      agility: 5,
    });
  });

  it("装备终值只算穿戴中的 damage / block", () => {
    expect(equipmentFinalsOf(wearer)).toEqual({ ...EMPTY_STATS, damage: 2, block: 3 });
  });

  it("本次动用的道具只算一次：在槽里走装备，在背包里补进来", () => {
    const torch = item("背包里的火把", { damage: 8 });
    // 背包里的道具被 `use`：补进终值。
    expect(equipmentFinalsOf(wearer, torch)).toEqual({ ...EMPTY_STATS, damage: 10, block: 3 });
    // 已经穿在身上的武器再传一次，不重复相加。
    expect(equipmentFinalsOf(wearer, item("短刃", { damage: 2 }))).toEqual({
      ...EMPTY_STATS,
      damage: 2,
      block: 3,
    });
  });

  it("悬空槽位不产生任何加成", () => {
    const dangling = {
      stats: { ...EMPTY_STATS, strength: 1 },
      equipment: { armor: "已经不在背包里的甲" },
      items: [],
    };
    expect(effectiveSourcesOf(dangling)).toEqual({ ...EMPTY_STATS, strength: 1 });
    expect(equipmentFinalsOf(dangling)).toEqual(EMPTY_STATS);
  });
});

describe("agility contests", () => {
  it("查看：只有自己更快才不留痕迹", () => {
    expect(inspectNoticed({ self: 5, target: 4 }, true)).toBe(false);
    expect(inspectNoticed({ self: 4, target: 4 }, true)).toBe(true);
    expect(inspectNoticed({ self: 3, target: 4 }, true)).toBe(true);
  });

  it("查看：尸体不会察觉，关掉规则后活人也不察觉", () => {
    expect(inspectNoticed({ self: 1, target: 9 }, false)).toBe(false);
    expect(inspectNoticed({ self: 1, target: 9 }, true, AWARENESS_OFF)).toBe(false);
  });

  it("窃取：达不到目标敏捷就不成立，持平得手但被察觉", () => {
    expect(stealOutcome({ self: 6, target: 5 })).toEqual({ allowed: true, noticed: false });
    expect(stealOutcome({ self: 5, target: 5 })).toEqual({ allowed: true, noticed: true });
    expect(stealOutcome({ self: 4, target: 5 })).toEqual({ allowed: false, noticed: false });
  });

  it("窃取：关掉规则后恒得手且不被察觉", () => {
    expect(stealOutcome({ self: 1, target: 9 }, AWARENESS_OFF)).toEqual({
      allowed: true,
      noticed: false,
    });
  });

  it("面向 agent 的表述跟着开关走", () => {
    expect(awarenessRuleText("inspect")).toContain("你的敏捷高于目标时无人察觉");
    expect(awarenessRuleText("steal")).toContain("持平也能得手");
    // 关掉后不能再描述一套已经不存在的判定。
    expect(awarenessRuleText("inspect", AWARENESS_OFF)).toBe("查看不会惊动任何人。");
    expect(awarenessRuleText("steal", AWARENESS_OFF)).toBe("窃取不会被拦下，也不会惊动对方。");
  });
});
