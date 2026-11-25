import { describe, expect, it } from "vitest";
import { BROKEN_BRIDGE_INN_WORLD } from "../seeds/dark-fantasy";
import { actorInnateActions, parseWorldContent } from "../src/game/world-definition";

const world = parseWorldContent(BROKEN_BRIDGE_INN_WORLD);

function actor(key: string) {
  const found = world.actors.find((candidate) => candidate.key === key);
  if (!found) {
    throw new Error(`缺少 actor: ${key}`);
  }
  return found;
}

describe("broken-bridge-inn seed world", () => {
  it("keeps one room and three talking actors in it", () => {
    expect(world.worldName).toBe("断桥客栈的故事");
    expect(world.contentVersion).toBe("broken-bridge-inn.v2");
    expect(world.stages.map((stage) => stage.name)).toEqual(["炉厅"]);
    expect(world.connections).toEqual([]);
    expect(world.actors.map((entry) => entry.name)).toEqual(["温娜", "戈特", "无名旅人"]);
    expect(world.actors.every((entry) => entry.stageKey === "hearth-room")).toBe(true);
    expect(world.actors.filter((entry) => entry.isDefaultPlayer).map((entry) => entry.key)).toEqual(
      ["traveler"],
    );
  });

  it("gives every actor the three ways to talk and nothing to hide behind", () => {
    for (const entry of world.actors) {
      expect(actorInnateActions(entry)).toEqual(
        expect.arrayContaining(["say", "whisper", "announce", "wait"]),
      );
      expect(entry.concealed).toBeUndefined();
    }
    // 没有武器，就不该出现由武器借出的动作；肉搏是三个人共同的退路。
    for (const entry of world.actors) {
      expect(actorInnateActions(entry)).not.toContain("strike");
      expect(actorInnateActions(entry)).not.toContain("cleave");
      expect(actorInnateActions(entry)).toContain("brawl");
    }
  });

  it("keeps the inn's other two guests without anything to swap", () => {
    for (const key of ["wenna", "gott"]) {
      const entry = actor(key);
      expect(entry.inventory).toEqual([]);
      expect(entry.equipment).toBeUndefined();
      expect(actorInnateActions(entry)).not.toContain("equip");
      expect(actorInnateActions(entry)).not.toContain("unequip");
    }
  });

  it("gives the traveler swappable clothes for the appearance notification path", () => {
    const traveler = actor("traveler");
    expect(actorInnateActions(traveler)).toEqual(expect.arrayContaining(["equip", "unequip"]));

    const byName = new Map(traveler.inventory.map((item) => [item.name, item]));
    // 穿戴索引里的名字必须真在背包里，否则外观推理拿不到那件道具。
    expect(Object.values(traveler.equipment ?? {}).every((name) => byName.has(name))).toBe(true);
    // 同槽至少两件才能换：护甲与饰品各一槽。
    expect([...byName.values()].filter((item) => item.kind === "equipment")).toHaveLength(2);
    expect([...byName.values()].filter((item) => item.kind === "accessory")).toHaveLength(2);
    // 一件参与外观的饰品与一件不参与的饰品，覆盖广播与静默两条路。
    const appearances = new Set(
      [...byName.values()]
        .filter((item) => item.kind === "accessory")
        .map((item) => item.appearsInAppearance),
    );
    expect(appearances).toEqual(new Set([true, false]));
  });

  it("keeps names observer-specific and the player a stranger", () => {
    expect(world.signatureNames).toEqual([
      { observer: "wenna", subject: "gott", name: "戈特" },
      { observer: "gott", subject: "wenna", name: "温掌柜" },
      { observer: "wenna", subject: "traveler", name: "披斗篷的" },
      { observer: "gott", subject: "traveler", name: "披斗篷的" },
      { observer: "traveler", subject: "wenna", name: "掌柜的" },
      { observer: "traveler", subject: "gott", name: "盐贩子" },
    ]);
    // 玩家真名不出现在任何开局称呼里；两个 NPC 也不知道它。
    const knownNames = (world.signatureNames ?? []).map((edge) => edge.name);
    expect(knownNames).not.toContain("无名旅人");
    expect(actor("traveler").profile).toContain("你没有告诉任何人你的名字");
    expect(actor("wenna").openingBriefing).toContain("你不知道他的真名");
    expect(actor("gott").openingBriefing).toContain("温掌柜");
  });

  it("keeps the stage to environment and reporting, and the world to endings", () => {
    const room = world.stages[0];
    expect(room?.actions).toEqual(["submit_environment", "notify_world"]);
    expect(room?.anchors?.map((anchor) => anchor.label)).toEqual(["炉膛", "柜台", "店门"]);
    expect(world.actions).toEqual(["notify_stage", "end_game"]);
    expect(world.profile).toContain("只有两种收尾");
    expect(world.profile).toContain("有人推门走进雨里");
    expect(world.profile).toContain("已经全部睡下");
  });

  it("passes content validation", () => {
    expect(() => parseWorldContent(BROKEN_BRIDGE_INN_WORLD)).not.toThrow();
  });
});
