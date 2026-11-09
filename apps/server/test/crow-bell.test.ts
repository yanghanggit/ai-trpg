import { describe, expect, it } from "vitest";
import { CROW_BELL_WORLD } from "../seeds/dark-fantasy";
import { parseWorldContent } from "../src/game/parse-world-content";

const world = parseWorldContent(CROW_BELL_WORLD);

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

describe("crow-bell seed world", () => {
  it("keeps three actors in the graveyard and exactly one default player", () => {
    expect(world.worldName).toBe("灰炉墓园的故事");
    expect(world.stages.map((item) => item.name)).toEqual(["灰炉墓园", "钟楼", "钟井"]);
    expect(world.actors.map((item) => item.name)).toEqual([
      "钟父卡兰",
      "鸦猎薇拉",
      "拾骨人伊莱",
    ]);
    expect(world.actors.every((item) => item.stageKey === "graveyard")).toBe(true);
    expect(world.actors.filter((item) => item.isDefaultPlayer).map((item) => item.key)).toEqual([
      "eli",
    ]);
  });

  it("seals the tower and the well behind the graveyard, and lets both return", () => {
    expect(world.connections).toEqual(
      expect.arrayContaining([
        { from: "graveyard", to: "bell-tower", passage: "sealed" },
        { from: "bell-tower", to: "graveyard" },
        { from: "graveyard", to: "bell-well", passage: "sealed" },
        { from: "bell-well", to: "graveyard" },
      ]),
    );
    expect(stage("graveyard").actions).toEqual(
      expect.arrayContaining(["submit_environment", "open_passage"]),
    );
    expect(stage("bell-tower").actions).toContain("notify_world");
    expect(stage("bell-well").actions).toContain("notify_world");
  });

  it("puts the tower key on the mad father and the clapper in the cracked bell", () => {
    const kalan = actor("kalan");
    expect(kalan.equipment).toEqual({ weapon: "钟锤", armor: "钟匠围裙" });
    // 钥匙是剧情道具，不在穿戴槽里：活着能偷，死后留在尸体背包。
    expect(kalan.items.find((item) => item.name === "钟楼钥匙")).toMatchObject({
      key: "bell-tower-key",
      kind: "valuable",
      affixes: { use: [{ name: "开锁", mode: "static" }] },
    });
    expect(kalan.items.find((item) => item.name === "钟楼钥匙")?.kind).not.toBe("material");
    expect(world.visitedStages).toEqual(
      expect.arrayContaining([
        { actor: "kalan", stage: "bell-tower" },
        { actor: "kalan", stage: "bell-well" },
      ]),
    );

    const clapper = stage("graveyard")
      .anchors?.find((anchor) => anchor.label === "裂钟")
      ?.items?.find((item) => item.name === "断钟舌");
    expect(clapper).toMatchObject({
      key: "cracked-clapper",
      kind: "valuable",
      affixes: { use: [{ name: "挂铃舌", mode: "static" }] },
    });
    expect(stage("graveyard").anchors?.map((anchor) => anchor.label)).toEqual(
      expect.arrayContaining(["木门", "空钟架", "裂钟", "新坟"]),
    );
  });

  it("gives the crow hunter a half bell and a remembered name, but keeps the player ignorant", () => {
    const vela = actor("vela");
    expect(vela.items.find((item) => item.name === "半枚铜铃")).toMatchObject({
      key: "half-bell",
      kind: "valuable",
      affixes: {
        use: [
          { name: "半铃回响", mode: "static" },
          { name: "旧日的铃声", mode: "agent" },
        ],
      },
    });
    // 只有薇拉开局记得卡兰；卡兰疯了不认人，伊莱谁都不认识。
    expect(world.signatureNames).toEqual([{ observer: "vela", subject: "kalan", name: "卡兰" }]);
    expect(actor("kalan").profile).toContain("你疯了之后不再认人");
    expect(actor("eli").openingBriefing).toContain("你都不认识");
  });

  it("writes the two opening rules and the three endings into the content", () => {
    expect(stage("graveyard").profile).toContain("对木门使用钟楼钥匙即开锁");
    expect(stage("graveyard").profile).toContain("对空钟架使用断钟舌即挂上钟舌");
    expect(stage("bell-tower").profile).toContain("必须向世界报告");
    expect(stage("bell-well").profile).toContain("井底的东西见了光");
    expect(world.profile).toContain("拾骨人从钟楼离开墓园");
    expect(world.profile).toContain("拾骨人死在这里");
    expect(world.profile).toContain("石壁后的钟井被打开");
  });
});
