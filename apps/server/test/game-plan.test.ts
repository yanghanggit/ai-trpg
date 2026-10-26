import { describe, expect, it } from "vitest";
import { buildAnnounceTool, parseAnnounce } from "../src/game/actions/announce";
import { buildAttackTool, parseAttack } from "../src/game/actions/attack";
import { buildEquipTool, parseEquip } from "../src/game/actions/equip";
import { buildGiveTool, parseGive } from "../src/game/actions/give";
import { buildMoveTool, parseMove } from "../src/game/actions/move";
import { buildPickupTool, parsePickup } from "../src/game/actions/pickup";
import { buildSayTool, parseSay } from "../src/game/actions/say";
import { buildStealTool, parseSteal } from "../src/game/actions/steal";
import { buildUnequipTool, parseUnequip } from "../src/game/actions/unequip";
import { buildUseTool, parseUse } from "../src/game/actions/use";
import { buildWaitTool, parseWait } from "../src/game/actions/wait";
import { buildWhisperTool, parseWhisper } from "../src/game/actions/whisper";
import {
  describeEquipment,
  describeItems,
  describeObservedActor,
  describeSelf,
  describeStats,
} from "../src/game/plan";
import { parseEndGame } from "../src/game/world-plan";

describe("action tools", () => {
  it("每类动作都是独立工具，参数即它的全部输入", () => {
    const targets = ["提灯修士"];
    const stages = ["断钟中殿"];
    const items = ["裂齿短刃"];

    expect(buildSayTool(targets).function.name).toBe("say");
    expect(buildSayTool(targets).function.parameters.required).toEqual([
      "mind",
      "targetActorName",
      "message",
    ]);
    expect(buildWhisperTool(targets).function.name).toBe("whisper");
    expect(buildAnnounceTool().function.parameters.required).toEqual(["mind", "message"]);
    expect(buildMoveTool(stages).function.parameters.required).toEqual(["targetStageName"]);
    expect(buildWaitTool().function.parameters.required).toEqual([]);
    expect(buildAttackTool(targets).function.parameters.required).toEqual(["targetActorName"]);
    expect(buildStealTool(targets).function.parameters.required).toEqual([
      "targetActorName",
      "itemName",
    ]);
    expect(buildGiveTool(targets).function.parameters.required).toEqual([
      "targetActorName",
      "itemName",
    ]);
    expect(buildPickupTool().function.parameters.required).toEqual(["itemName"]);
    expect(buildUseTool(items, targets, "灰烬门廊").function.parameters.required).toEqual([
      "itemName",
    ]);
    expect(buildEquipTool(items).function.parameters.required).toEqual(["itemName", "slot"]);
    expect(buildUnequipTool(["weapon"]).function.parameters.required).toEqual(["slot"]);

    // 每个工具的参数就是它自己的输入，没有中间层字段。
    const attackProps = Object.keys(buildAttackTool(targets).function.parameters.properties ?? {});
    expect(attackProps).toEqual(["targetActorName"]);
    const useProps = Object.keys(
      buildUseTool(items, targets, "灰烬门廊").function.parameters.properties ?? {},
    );
    expect(useProps).toEqual(["itemName", "targetActorName", "targetStageName", "targetDetail"]);
    expect(Object.keys(buildEquipTool(items).function.parameters.properties ?? {})).toEqual([
      "itemName",
      "slot",
    ]);
  });
});

describe("action parsers", () => {
  it("只检查形状，产出平铺动作", () => {
    expect(parseSay({ mind: "问一句。", targetActorName: "提灯修士", message: "钟声？" })).toEqual({
      kind: "say",
      mind: "问一句。",
      targetActorName: "提灯修士",
      message: "钟声？",
    });
    expect(
      parseWhisper({ mind: "低声。", targetActorName: "提灯修士", message: "别回头。" }),
    ).toMatchObject({ kind: "whisper" });
    expect(parseAnnounce({ mind: "让所有人听见。", message: "灰里有人。" })).toEqual({
      kind: "announce",
      mind: "让所有人听见。",
      message: "灰里有人。",
    });
    expect(parseMove({ targetStageName: "断钟中殿" })).toEqual({
      kind: "move",
      targetStageName: "断钟中殿",
    });
    expect(parseWait()).toEqual({ kind: "wait" });
    // attack 不再接收物品名：武器由装备决定。
    expect(parseAttack({ targetActorName: " 提灯修士 ", itemName: "裂齿短刃" })).toEqual({
      kind: "attack",
      targetActorName: "提灯修士",
    });
    expect(parseEquip({ itemName: " 裂齿短刃 ", slot: " weapon " })).toEqual({
      kind: "equip",
      itemName: "裂齿短刃",
      slot: "weapon",
    });
    expect(parseUnequip({ slot: "armor" })).toEqual({ kind: "unequip", slot: "armor" });
    expect(() => parseUnequip({ slot: "head" })).toThrow("未知的装备槽位");
    expect(parseSteal({ targetActorName: "提灯修士", itemName: "铅封提灯" })).toEqual({
      kind: "steal",
      targetActorName: "提灯修士",
      itemName: "铅封提灯",
    });
    expect(parseGive({ targetActorName: "提灯修士", itemName: "裂齿短刃" })).toEqual({
      kind: "give",
      targetActorName: "提灯修士",
      itemName: "裂齿短刃",
    });
    expect(parsePickup({ itemName: "武器.测试火把" })).toEqual({
      kind: "pickup",
      itemName: "武器.测试火把",
    });
    expect(
      parseUse({
        itemName: "物品.闸门钥匙",
        targetStageName: "场景.铁闸门",
        targetDetail: "锁孔",
      }),
    ).toEqual({
      kind: "use",
      itemName: "物品.闸门钥匙",
      targetStageName: "场景.铁闸门",
      targetDetail: "锁孔",
    });
  });

  it("拒绝缺参数或参数冲突的调用", () => {
    expect(() => parseSay({ mind: "", targetActorName: "提灯修士", message: "喂" })).toThrow(
      "mind",
    );
    expect(() => parseSay({ mind: "说。", targetActorName: " ", message: "喂" })).toThrow(
      "targetActorName",
    );
    expect(() => parseSay({ mind: "说。", targetActorName: "提灯修士", message: "  " })).toThrow(
      "message",
    );
    expect(() => parseMove({ targetStageName: "" })).toThrow("targetStageName");
    expect(() =>
      parseUse({ itemName: "钥匙", targetActorName: "守烬人", targetDetail: "锁孔" }),
    ).toThrow("targetDetail");
    expect(() => parseAttack({ targetActorName: "  " })).toThrow("targetActorName");
    expect(() => parseSteal({ targetActorName: "提灯修士" })).toThrow("itemName");
    expect(() => parsePickup({})).toThrow("itemName");
    expect(() => parseUse({ itemName: "钥匙" })).toThrow("targetActorName 或 targetStageName");
    expect(() =>
      parseUse({ itemName: "钥匙", targetActorName: "提灯修士", targetStageName: "场景.铁闸门" }),
    ).toThrow("二选一");
  });
});

describe("world action parsers", () => {
  it("end_game 的结局标签由 world 自己命名，只要非空且不过长", () => {
    expect(parseEndGame({ outcome: "逃出修道院", message: "门在身后合上了。" })).toEqual({
      kind: "end_game",
      outcome: "逃出修道院",
      message: "门在身后合上了。",
    });
    expect(() => parseEndGame({ message: "门在身后合上了。" })).toThrow(/outcome/);
    expect(() => parseEndGame({ outcome: "", message: "门在身后合上了。" })).toThrow(/outcome/);
    expect(() => parseEndGame({ outcome: "长".repeat(25), message: "门在身后合上了。" })).toThrow(
      /outcome/,
    );
  });
});

describe("read-only descriptions", () => {
  it("renders own stats and items", () => {
    const actor = {
      id: "actor-1",
      name: "守烬人",
      profile: "拾荒者",
      appearance: "披着旧斗篷。",
      baseBody: { race: "人类", description: "瘦削，手腕有旧绳痕。" },
      hp: 12,
      stats: { maxHp: 12, strength: 3, wisdom: 2, agility: 4, damage: 3, block: 2 },
      isDefaultPlayer: false,
      equipment: { weapon: "裂齿短刃" },
      actions: [
        "say",
        "whisper",
        "announce",
        "move",
        "wait",
        "attack",
        "give",
        "pickup",
        "use",
      ] as const,
      items: [
        {
          id: "item-1",
          key: "cracked-blade",
          name: "裂齿短刃",
          description: "刃口崩了三处。",
          kind: "weapon" as const,
          count: 1,
          stats: { maxHp: 0, strength: 0, wisdom: 0, agility: 0, damage: 3, block: 0 },
          effect: { type: "damage" },
          affixes: [],
        },
      ],
    };

    expect(describeStats(actor)).toContain("HP：12/12");
    expect(describeStats(actor)).toContain("damage：3");
    expect(describeStats(actor)).toContain("block：2");
    // attack / defense 保留在数据里，但不再对外展示。
    expect(describeStats(actor)).not.toContain("attack：");
    expect(describeStats(actor)).not.toContain("defense：");
    expect(describeStats(actor)).toContain("状态：存活");
    expect(describeItems(actor)).toContain("裂齿短刃（weapon，count 1，已穿戴）：刃口崩了三处。");
    expect(describeItems({ items: [], equipment: {} })).toBe("物品：无");
    expect(describeEquipment(actor)).toContain("武器：裂齿短刃");
    expect(describeSelf(actor)).toContain("外观：披着旧斗篷。");
    expect(describeSelf(actor)).toContain("裂齿短刃");
    expect(describeObservedActor(actor)).toContain("裂齿短刃");
    expect(describeObservedActor(actor)).not.toContain("HP：");
  });
});
