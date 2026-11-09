import { describe, expect, it } from "vitest";
import { type ItemIdentity, isSameItem } from "../src/game/item-identity";

const BASE: ItemIdentity = {
  kind: "weapon",
  name: "裂齿短刃",
  description: "刃口崩了三处。",
  stats: { damage: 3, block: 0 },
  affixes: {},
  actions: ["strike"],
  source: null,
};

describe("item identity", () => {
  it("treats the same definition as one kind of item", () => {
    expect(isSameItem(BASE, { ...BASE })).toBe(true);
    // jsonb 读回的键序不稳定：键序不同仍是同一种。
    expect(isSameItem(BASE, { ...BASE, stats: { block: 0, damage: 3 } })).toBe(true);
    // 词缀按触发分组，键序同理。
    expect(
      isSameItem(
        {
          ...BASE,
          affixes: { strike: [{ name: "松脂", content: "见火就着。", mode: "static", ops: [] }] },
        },
        {
          ...BASE,
          affixes: { strike: [{ content: "见火就着。", name: "松脂", ops: [], mode: "static" }] },
        },
      ),
    ).toBe(true);
  });

  it("ignores provenance fields", () => {
    // 来源信息（行 id、序号、数量、归属、内容键）不参与判定。
    const row = { ...BASE, id: "x", seq: 12, count: 4, key: "cracked-blade", actorId: "a" };
    expect(isSameItem(row, BASE)).toBe(true);
  });

  it("separates items that only look alike", () => {
    expect(isSameItem(BASE, { ...BASE, description: "刃口完好。" })).toBe(false);
    expect(isSameItem(BASE, { ...BASE, kind: "consumable" })).toBe(false);
    expect(isSameItem(BASE, { ...BASE, stats: { damage: 9, block: 0 } })).toBe(false);
    expect(
      isSameItem(BASE, {
        ...BASE,
        affixes: {
          strike: [
            {
              name: "裂齿",
              content: "造成 3 点伤害",
              mode: "static",
              ops: [{ kind: "damage", amount: 3 }],
            },
          ],
        },
      }),
    ).toBe(false);
    expect(isSameItem(BASE, { ...BASE, actions: [] })).toBe(false);
    expect(isSameItem(BASE, { ...BASE, source: "奥德里克" })).toBe(false);
  });
});
