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
    expect(stage("sealed-gate").items ?? []).toEqual([]);
  });

  it("gives the keeper the key and makes the rat king a lethal sleeper", () => {
    const keeper = DARK_FANTASY_WORLD.actors.find((actor) => actor.name === "角色.守墓人");
    const king = DARK_FANTASY_WORLD.actors.find((actor) => actor.name === "角色.鼠王");
    expect(keeper?.items.map((item) => item.name)).toEqual(["饰品.封骨钥匙"]);
    expect(king?.hp).toBeGreaterThan(keeper?.hp ?? 0);
    expect(king?.attack).toBeGreaterThan(20);
    expect(king?.defense).toBeGreaterThan(king?.attack ?? 0);
    expect(king?.statusEffects.map((status) => status.name)).toEqual(["沉睡"]);
  });

  it("connects the graveyard, crypt, rat hall, pyre and sealed gate", () => {
    const edges = new Set(
      DARK_FANTASY_WORLD.connections.map((connection) => `${connection.from}->${connection.to}`),
    );
    for (const edge of [
      "graveyard->crypt",
      "crypt->graveyard",
      "crypt->rat-hall",
      "rat-hall->crypt",
      "graveyard->rat-hall",
      "rat-hall->graveyard",
      "rat-hall->pyre",
      "pyre->rat-hall",
      "pyre->sealed-gate",
      "sealed-gate->pyre",
    ]) {
      expect(edges.has(edge)).toBe(true);
    }
  });
});
