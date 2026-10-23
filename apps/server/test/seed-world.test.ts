import { describe, expect, it } from "vitest";
import { DARK_FANTASY_WORLD } from "../seeds/dark-fantasy";

const { stages } = DARK_FANTASY_WORLD;

function stage(key: string) {
  const found = stages.find((candidate) => candidate.key === key);
  if (!found) {
    throw new Error(`缺少 stage: ${key}`);
  }
  return found;
}

describe("dark fantasy seed world", () => {
  it("keeps the five-stage story and naming convention", () => {
    expect(stages.map((item) => item.name)).toEqual([
      "场景.守墓人的灰庭",
      "场景.浅眠墓穴",
      "场景.鼠王的骨厅",
      "场景.焚毛炉房",
      "场景.封骨之门",
    ]);
    expect(DARK_FANTASY_WORLD.initialStageKey).toBe("crypt");
    expect(DARK_FANTASY_WORLD.actors.map((actor) => actor.name)).toEqual([
      "角色.守墓人",
      "角色.守墓犬",
      "角色.灰尾小鼠",
      "角色.苏醒者",
      "角色.鼠王",
    ]);
  });

  it("places the requested actors and the fire weapon", () => {
    expect(
      DARK_FANTASY_WORLD.actors.filter((actor) => actor.stageKey === "graveyard"),
    ).toHaveLength(3);
    expect(DARK_FANTASY_WORLD.actors.filter((actor) => actor.stageKey === "crypt")).toHaveLength(1);
    expect(DARK_FANTASY_WORLD.actors.filter((actor) => actor.stageKey === "rat-hall")).toHaveLength(
      1,
    );
    expect(stage("pyre").items?.map((item) => item.name)).toEqual(["武器.焚鼠火把"]);
    expect(stage("pyre").items?.[0]).toMatchObject({
      kind: "weapon",
      count: 1,
      damage: 250,
      block: 0,
    });
    expect(stage("sealed-gate").items ?? []).toEqual([]);
  });

  it("gives the keeper the key and makes the rat king a lethal sleeper", () => {
    const keeper = DARK_FANTASY_WORLD.actors.find((actor) => actor.name === "角色.守墓人");
    const king = DARK_FANTASY_WORLD.actors.find((actor) => actor.name === "角色.鼠王");
    expect(keeper?.items.map((item) => item.name)).toEqual(["饰品.封骨钥匙"]);
    expect(king?.hp).toBeGreaterThan(keeper?.hp ?? 0);
    expect(king?.attack).toBeGreaterThan(20);
    expect(king?.defense).toBeGreaterThan(king?.attack ?? 0);
    expect(king?.profile).toContain("正在沉睡");
    expect(king?.profile).toContain("只能包含 wait");
  });

  it("declares per-actor actions explicitly in the seed", () => {
    const actionsOf = (name: string) => [
      ...(DARK_FANTASY_WORLD.actors.find((actor) => actor.name === name)?.actions ?? []),
    ];

    const TALK_AND_MOVE = ["say", "whisper", "announce", "move", "wait"];
    const ITEM_ACTIONS = ["give", "pickup", "use"];

    // 活物都会说话、走动与等待。
    for (const actor of DARK_FANTASY_WORLD.actors) {
      expect(actor.actions).toEqual(expect.arrayContaining(TALK_AND_MOVE));
    }

    // 动物不操作道具。
    for (const animal of ["角色.守墓犬", "角色.灰尾小鼠", "角色.鼠王"]) {
      for (const action of [...ITEM_ACTIONS, "steal"]) {
        expect(actionsOf(animal)).not.toContain(action);
      }
    }

    // 狗与鼠王会攻击，幼崽不会。
    expect(actionsOf("角色.守墓犬")).toContain("attack");
    expect(actionsOf("角色.鼠王")).toContain("attack");
    expect(actionsOf("角色.灰尾小鼠")).not.toContain("attack");

    // 人类可以操作道具；偷窃只属于苏醒者。
    for (const human of ["角色.守墓人", "角色.苏醒者"]) {
      for (const action of ITEM_ACTIONS) {
        expect(actionsOf(human)).toContain(action);
      }
    }
    expect(actionsOf("角色.苏醒者")).toContain("steal");
    expect(actionsOf("角色.守墓人")).not.toContain("steal");

    // 场景默认不额外限制动作。
    for (const item of stages) {
      expect(item.actions ?? []).toEqual([]);
    }
  });

  it("connects the graveyard, crypt, rat hall, pyre and sealed gate", () => {
    const edges = new Set(
      DARK_FANTASY_WORLD.connections.map((connection) => `${connection.from}->${connection.to}`),
    );
    expect([...edges].sort()).toEqual(
      [
        "crypt->graveyard",
        "graveyard->rat-hall",
        "rat-hall->graveyard",
        "graveyard->pyre",
        "pyre->graveyard",
        "graveyard->sealed-gate",
        "sealed-gate->graveyard",
      ].sort(),
    );
  });
});
