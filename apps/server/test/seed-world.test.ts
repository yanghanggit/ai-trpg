import { describe, expect, it } from "vitest";
import { DARK_FANTASY_WORLD } from "../seeds/dark-fantasy";
import { DARK_FANTASY_KNOWLEDGE } from "../seeds/knowledge/dark-fantasy";
import { resolveAppearance } from "../src/game/body";

const { stages } = DARK_FANTASY_WORLD;

function stage(key: string) {
  const found = stages.find((candidate) => candidate.key === key);
  if (!found) {
    throw new Error(`缺少 stage: ${key}`);
  }
  return found;
}

describe("dark fantasy seed world", () => {
  it("keeps the five-stage monastery story", () => {
    expect(stages.map((item) => item.name)).toEqual([
      "场景.墓园",
      "场景.乱葬坑",
      "场景.地窖",
      "场景.焚尸房",
      "场景.铁闸门",
    ]);
    expect(DARK_FANTASY_WORLD.worldName).toBe("枯钟修道院");
    expect(DARK_FANTASY_WORLD.initialStageKey).toBe("plague-pit");
    expect(DARK_FANTASY_WORLD.actors.map((actor) => actor.name)).toEqual([
      "角色.奥德里克",
      "角色.煤渣",
      "角色.坏运气",
      "角色.无名者",
      "角色.鼠王",
    ]);
  });

  it("places the actors in the monastery and keeps the fire weapon", () => {
    expect(
      DARK_FANTASY_WORLD.actors.filter((actor) => actor.stageKey === "graveyard"),
    ).toHaveLength(3);
    expect(
      DARK_FANTASY_WORLD.actors.filter((actor) => actor.stageKey === "plague-pit"),
    ).toHaveLength(1);
    expect(DARK_FANTASY_WORLD.actors.filter((actor) => actor.stageKey === "cellar")).toHaveLength(
      1,
    );
    expect(stage("crematorium").items?.map((item) => item.name)).toEqual(["武器.焚鼠火把"]);
    expect(stage("crematorium").items?.[0]).toMatchObject({
      kind: "weapon",
      count: 1,
      stats: { damage: 250, block: 0 },
    });
    expect(stage("gate").items ?? []).toEqual([]);
  });

  it("gives the keeper the gate key and makes the rat king a lethal sleeper", () => {
    const keeper = DARK_FANTASY_WORLD.actors.find((actor) => actor.name === "角色.奥德里克");
    const king = DARK_FANTASY_WORLD.actors.find((actor) => actor.name === "角色.鼠王");
    expect(keeper?.items.map((item) => item.name)).toEqual(
      expect.arrayContaining(["饰品.闸门钥匙", "武器.掘墓人的铁锹", "装备.补丁斗篷"]),
    );
    expect(keeper?.equipment).toEqual({
      weapon: "武器.掘墓人的铁锹",
      body: "装备.补丁斗篷",
      accessory: "饰品.闸门钥匙",
    });
    expect(keeper?.items.find((item) => item.name === "装备.补丁斗篷")).toMatchObject({
      kind: "equipment",
      stats: { block: 1 },
    });
    expect(keeper?.baseBody.race).toBe("人类");
    expect(keeper?.status).toBe("alive");
    expect(king?.baseBody.race).toBe("鼠");
    expect(king?.stats.hp).toBeGreaterThan(keeper?.stats.hp ?? 0);
    expect(king?.stats.attack).toBeGreaterThan(20);
    expect(king?.stats.defense).toBeGreaterThan(king?.stats.attack ?? 0);
    expect(king?.profile).toContain("沉睡在地窖");
    expect(king?.profile).toContain("苏醒前你的计划只能包含 wait");
  });

  it("keeps human appearance clothed and lets animals fall back to base body", () => {
    const keeper = DARK_FANTASY_WORLD.actors.find((actor) => actor.name === "角色.奥德里克");
    const king = DARK_FANTASY_WORLD.actors.find((actor) => actor.name === "角色.鼠王");
    if (!king) {
      throw new Error("缺少鼠王");
    }
    expect(keeper?.appearance).toContain("斗篷");
    expect(king.appearance).toBeUndefined();
    expect(resolveAppearance(king)).toBe(king.baseBody.description);
  });

  it("encodes the plague backstory in the world text", () => {
    expect(DARK_FANTASY_WORLD.initialNarration).toContain("石灰");
    expect(DARK_FANTASY_WORLD.initialNarration).toContain("裹尸布");
    expect(stage("plague-pit").profile).toContain("黑疖病");
    expect(stage("crematorium").profile).toContain("黑疖病");
    const keeper = DARK_FANTASY_WORLD.actors.find((actor) => actor.name === "角色.奥德里克");
    expect(keeper?.profile).toContain("黑疖病");
    expect(keeper?.profile).toContain("旧钟无名");
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
    for (const animal of ["角色.煤渣", "角色.坏运气", "角色.鼠王"]) {
      for (const action of [...ITEM_ACTIONS, "steal"]) {
        expect(actionsOf(animal)).not.toContain(action);
      }
    }

    // 狗与鼠王会攻击，幼崽不会。
    expect(actionsOf("角色.煤渣")).toContain("attack");
    expect(actionsOf("角色.鼠王")).toContain("attack");
    expect(actionsOf("角色.坏运气")).not.toContain("attack");

    // 人类可以操作道具；偷窃只属于无名者。
    for (const human of ["角色.奥德里克", "角色.无名者"]) {
      for (const action of ITEM_ACTIONS) {
        expect(actionsOf(human)).toContain(action);
      }
    }
    expect(actionsOf("角色.无名者")).toContain("steal");
    expect(actionsOf("角色.奥德里克")).not.toContain("steal");

    // 每个场景都声明了自己作为小 GM 的能力。
    for (const item of stages) {
      expect(item.actions).toEqual(["submit_environment"]);
    }
  });

  it("keeps the public knowledge base free of actor secrets", () => {
    const text = Object.values(DARK_FANTASY_KNOWLEDGE).flat().join("\n");
    for (const actor of DARK_FANTASY_WORLD.actors) {
      expect(text).not.toContain(actor.name);
    }
    for (const secret of ["钥匙", "秘密", "弱点", "沉睡", "追杀"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("only native actors list the public knowledge tool in actions", () => {
    const actionsOf = (name: string) =>
      DARK_FANTASY_WORLD.actors.find((actor) => actor.name === name)?.actions ?? [];

    for (const native of ["角色.奥德里克", "角色.坏运气", "角色.鼠王"]) {
      expect(actionsOf(native)).toContain("query");
    }
    for (const other of ["角色.煤渣", "角色.无名者"]) {
      expect(actionsOf(other)).not.toContain("query");
    }
  });

  it("connects the graveyard, plague pit, cellar, crematorium and gate", () => {
    const edges = new Set(
      DARK_FANTASY_WORLD.connections.map((connection) => `${connection.from}->${connection.to}`),
    );
    expect([...edges].sort()).toEqual(
      [
        "plague-pit->graveyard",
        "graveyard->cellar",
        "cellar->graveyard",
        "graveyard->crematorium",
        "crematorium->graveyard",
        "graveyard->gate",
        "gate->graveyard",
      ].sort(),
    );
  });
});
