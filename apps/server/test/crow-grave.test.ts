import { describe, expect, it } from "vitest";
import { CROW_GRAVE_WORLD } from "../seeds/dark-fantasy";
import { parseWorldContent } from "../src/game/parse-world-content";

const world = parseWorldContent(CROW_GRAVE_WORLD);

function stage(key: string) {
  const found = world.stages.find((candidate) => candidate.key === key);
  if (!found) {
    throw new Error(`缺少 stage: ${key}`);
  }
  return found;
}

function actor(key: string) {
  const found = world.actors.find((candidate) => candidate.key === key);
  if (!found) {
    throw new Error(`缺少 actor: ${key}`);
  }
  return found;
}

describe("crow-grave seed world", () => {
  it("keeps three actors in the graveyard and exactly one default player", () => {
    expect(world.worldName).toBe("鸦葬岗的故事");
    expect(world.stages.map((item) => item.name)).toEqual(["鸦葬岗", "守夜塔", "封尸窖"]);
    expect(world.actors.map((item) => item.name)).toEqual(["收尸人卡尔", "鸦猎薇拉", "拾骨人伊莱"]);
    expect(world.actors.every((item) => item.stageKey === "graveyard")).toBe(true);
    expect(world.actors.filter((item) => item.isDefaultPlayer).map((item) => item.key)).toEqual([
      "eli",
    ]);
  });

  it("keeps the story, props and locations free of the old motif", () => {
    // 只检查剧本层的故事内容；战役设定、全局规则与共享职能 agent 不属于这个剧本。
    const story = {
      contentKey: world.contentKey,
      contentVersion: world.contentVersion,
      worldName: world.worldName,
      profile: world.profile,
      stages: world.stages,
      connections: world.connections,
      actors: world.actors,
      signatureNames: world.signatureNames,
      visitedStages: world.visitedStages,
    };
    expect(JSON.stringify(story)).not.toContain("钟");
  });

  it("seals the watchtower and the plague cellar behind the graveyard, and lets both return", () => {
    expect(world.connections).toEqual(
      expect.arrayContaining([
        { from: "graveyard", to: "watchtower", passage: "sealed" },
        { from: "watchtower", to: "graveyard" },
        { from: "graveyard", to: "plague-cellar", passage: "sealed" },
        { from: "plague-cellar", to: "graveyard" },
      ]),
    );
    expect(stage("graveyard").actions).toEqual(
      expect.arrayContaining(["submit_environment", "open_passage"]),
    );
    expect(stage("watchtower").actions).toContain("notify_world");
    expect(stage("plague-cellar").actions).toContain("notify_world");
  });

  it("puts the tower key on the mad corpse-collector and the pin in the corpse cart", () => {
    const karl = actor("karl");
    expect(karl.equipment).toEqual({ weapon: "封尸锤", armor: "尸布围裙" });
    // 钥匙是剧情道具，不在穿戴槽里：活着能偷，死后留在尸体背包。
    expect(karl.items.find((item) => item.name === "塔门钥匙")).toMatchObject({
      key: "tower-key",
      kind: "valuable",
      affixes: { use: [{ name: "开锁", mode: "static" }] },
    });
    expect(karl.items.find((item) => item.name === "塔门钥匙")?.kind).not.toBe("material");
    expect(world.visitedStages).toEqual(
      expect.arrayContaining([
        { actor: "karl", stage: "watchtower" },
        { actor: "karl", stage: "plague-cellar" },
      ]),
    );

    const pin = stage("graveyard")
      .anchors?.find((anchor) => anchor.label === "尸车")
      ?.items?.find((item) => item.name === "窖钉");
    expect(pin).toMatchObject({
      key: "cellar-pin",
      kind: "valuable",
      affixes: { use: [{ name: "插进凹槽", mode: "static" }] },
    });
    expect(stage("graveyard").anchors?.map((anchor) => anchor.label)).toEqual(
      expect.arrayContaining(["塔门", "锁石", "尸车", "新坟"]),
    );
  });

  it("gives the crow hunter an old bone whistle and a remembered name, but keeps the player ignorant", () => {
    const vela = actor("vela");
    expect(vela.items.find((item) => item.name === "旧骨哨")).toMatchObject({
      key: "old-bone-whistle",
      kind: "valuable",
      affixes: {
        use: [
          { name: "吹响", mode: "static" },
          { name: "旧日的哨声", mode: "agent" },
        ],
      },
    });
    // 只有薇拉开局记得卡尔；卡尔疯了不认人，伊莱谁都不认识。
    expect(world.signatureNames).toEqual([{ observer: "vela", subject: "karl", name: "卡尔" }]);
    expect(actor("karl").profile).toContain("你疯了之后不再认人");
    expect(actor("eli").openingBriefing).toContain("你都不认识");
  });

  it("binds the attack to the weapon and keeps brawl innate", () => {
    const weapons = world.actors
      .flatMap((entry) => entry.items)
      .filter((item) => item.kind === "weapon");
    expect(weapons.map((weapon) => weapon.name)).toEqual(["封尸锤", "鸦啄", "拾骨钩"]);

    // 卡尔的封尸锤是长柄重锤：单体砸击之外还能横扫并排的两个人。
    const hammer = weapons.find((weapon) => weapon.name === "封尸锤");
    expect(hammer?.actions).toEqual(["strike", "cleave"]);
    expect(hammer?.maxTargets).toBe(2);
    expect(hammer?.affixes?.cleave?.[0]?.name).toBe("横扫");

    // 两把刃器只提供单体挥击；目标数不是它们的属性。
    for (const weapon of ["鸦啄", "拾骨钩"]) {
      const blade = weapons.find((candidate) => candidate.name === weapon);
      expect(blade?.actions).toEqual(["strike"]);
      expect(blade?.affixes?.strike?.length ?? 0).toBeGreaterThan(0);
      expect(blade?.maxTargets ?? 1).toBe(1);
    }
    // 携带者动作不能出现在角色身上：这一条由内容校验挡在建局前，这里留住约定。
    for (const entry of world.actors) {
      expect([...entry.actions] as string[]).not.toContain("strike");
      expect(entry.actions).toContain("brawl");
    }
    // 只有拾骨人会偷；搜刮尸体是另一条通道，两个会取物的人都有。
    expect(actor("eli").actions).toContain("steal");
    expect(actor("vela").actions).not.toContain("steal");
    expect(actor("eli").actions).toContain("loot");
    expect(actor("vela").actions).toContain("loot");
    // 卡尔疯到不再操作道具，偷与搜刮都不会有。
    expect(actor("karl").actions).not.toContain("use");
    expect(actor("karl").actions).not.toContain("loot");
  });

  it("writes the two opening rules and the three endings into the content", () => {
    expect(stage("graveyard").profile).toContain("对塔门使用塔门钥匙即开锁");
    expect(stage("graveyard").profile).toContain("对锁石使用窖钉即打开锁石");
    expect(stage("watchtower").profile).toContain("必须向世界报告");
    expect(stage("plague-cellar").profile).toContain("窖底的东西见了光");
    expect(world.profile).toContain("拾骨人从守夜塔离开鸦葬岗");
    expect(world.profile).toContain("拾骨人死在这里");
    expect(world.profile).toContain("石壁后的封尸窖被打开");
  });
});
