import { describe, expect, it } from "vitest";
import {
  type ActorSnapshot,
  type ItemSnapshot,
  resolveRules,
  settle,
  settleAdditionalDamage,
} from "../src/game/gameplay/settlement";
import type { Stats } from "../src/game/kernel/attributes";

const BASE: Stats = { maxHp: 10, strength: 0, wisdom: 0, agility: 0, damage: 0, block: 0 };

function snapshot(
  role: "initiator" | "affected",
  facts: { damage?: number; block?: number; hp?: number; deathFinalized?: boolean },
): ActorSnapshot {
  return {
    role,
    actorId: role,
    name: role,
    stats: { ...BASE, damage: facts.damage ?? 0, block: facts.block ?? 0 },
    hp: facts.hp ?? 10,
    concealed: false,
    deathFinalized: facts.deathFinalized ?? false,
  };
}

function item(affixes: ItemSnapshot["affixes"]): ItemSnapshot {
  return { name: "短刃", stats: { ...BASE, damage: 3 }, affixes };
}

const STRIKE = item({
  strike: [
    {
      name: "锋",
      content: "造成 {{attack}} 点伤害",
      ops: [{ kind: "damage", amount: { ref: "attack" } }],
    },
  ],
});

describe("settle", () => {
  it("肉搏只减一次目标格挡，并按剩余生命截断实际值", () => {
    const outcome = settle({
      action: "brawl",
      initiator: snapshot("initiator", { damage: 10 }),
      affected: snapshot("affected", { block: 3, hp: 4 }),
      rules: resolveRules(),
      ambush: false,
    });

    expect(outcome.intended).toBe(10);
    expect(outcome.mitigated).toBe(7);
    expect(outcome.actual).toBe(4);
    expect(outcome.effects).toEqual([
      { kind: "damage", role: "affected", actorId: "affected", hpDelta: -7 },
    ]);
  });

  it("格挡不低于攻击力时减到 0，不出负伤害", () => {
    const outcome = settle({
      action: "brawl",
      initiator: snapshot("initiator", { damage: 3 }),
      affected: snapshot("affected", { block: 8 }),
      rules: resolveRules(),
      ambush: false,
    });

    expect(outcome.mitigated).toBe(0);
    expect(outcome.actual).toBe(0);
  });

  it("词缀伤害按快照攻击力求和，不再回库", () => {
    const outcome = settle({
      action: "strike",
      initiator: snapshot("initiator", { damage: 9 }),
      affected: snapshot("affected", { block: 2 }),
      item: STRIKE,
      rules: resolveRules(),
      ambush: false,
    });

    expect(outcome.intended).toBe(9);
    expect(outcome.mitigated).toBe(7);
    expect(outcome.rendered).toEqual(["[锋]造成 9 点伤害"]);
  });

  it("尸体空转：没有伤害效果，但保留一次命中", () => {
    const outcome = settle({
      action: "strike",
      initiator: snapshot("initiator", { damage: 9 }),
      affected: snapshot("affected", { block: 0, hp: 0 }),
      item: STRIKE,
      rules: resolveRules(),
      ambush: false,
    });

    expect(outcome.hit).toBe(true);
    expect(outcome.affectedWasDead).toBe(true);
    expect(outcome.actual).toBe(0);
    expect(outcome.effects).toEqual([]);
  });

  it("吸血按实际伤害派生，死亡已收尾的发起者不获得治疗", () => {
    const rules = resolveRules({ params: { lifestealRate: 0.5 } });
    const living = settle({
      action: "brawl",
      initiator: snapshot("initiator", { damage: 10 }),
      affected: snapshot("affected", { block: 0, hp: 7 }),
      rules,
      ambush: false,
    });
    expect(living.actual).toBe(7);
    expect(living.effects[1]).toEqual({
      kind: "heal",
      role: "initiator",
      actorId: "initiator",
      hpDelta: 3,
    });

    const finalized = settle({
      action: "brawl",
      initiator: snapshot("initiator", { damage: 10, deathFinalized: true }),
      affected: snapshot("affected", { block: 0 }),
      rules,
      ambush: false,
    });
    expect(finalized.effects.some((effect) => effect.kind === "heal")).toBe(false);
  });

  it("伏击条件只认动作事实", () => {
    const ambushAffix = item({
      strike: [
        {
          name: "伏",
          content: "自暗处",
          ops: [{ kind: "damage", amount: 5, when: "ambush" }],
        },
      ],
    });
    const hidden = settle({
      action: "strike",
      initiator: snapshot("initiator", {}),
      affected: snapshot("affected", {}),
      item: ambushAffix,
      rules: resolveRules(),
      ambush: true,
    });
    const open = settle({
      action: "strike",
      initiator: snapshot("initiator", {}),
      affected: snapshot("affected", {}),
      item: ambushAffix,
      rules: resolveRules(),
      ambush: false,
    });

    expect(hidden.intended).toBe(5);
    expect(open.intended).toBe(0);
  });

  it("推理端追加的伤害同样只在这里减一次防", () => {
    const outcome = settleAdditionalDamage({
      initiator: snapshot("initiator", { damage: 9 }),
      affected: snapshot("affected", { block: 4 }),
      rawDamage: 7,
      rules: resolveRules(),
    });

    expect(outcome.intended).toBe(7);
    expect(outcome.mitigated).toBe(3);
    expect(outcome.effects[0]).toMatchObject({ kind: "damage", hpDelta: -3 });
  });
});

describe("resolveRules", () => {
  it("默认关闭吸血，覆盖只影响本次快照", () => {
    expect(resolveRules().params.lifestealRate).toBe(0);
    expect(resolveRules({ params: { lifestealRate: 0.5 } }).params.lifestealRate).toBe(0.5);
    expect(resolveRules({ switches: { strengthAddsToAttack: false } }).switches).toMatchObject({
      strengthAddsToAttack: false,
      agilityGovernsAwareness: true,
    });
  });
});
