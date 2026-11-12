import { describe, expect, it } from "vitest";
import { assertActionAllowed } from "../src/game/actions";
import { buildAnnounceTool, parseAnnounce } from "../src/game/actions/announce";
import { buildBrawlTool, parseBrawl } from "../src/game/actions/brawl";
import { buildCallTool, parseCall } from "../src/game/actions/call";
import { buildCleaveTool, parseCleave } from "../src/game/actions/cleave";
import { buildEquipTool, parseEquip } from "../src/game/actions/equip";
import { buildGiveTool, parseGive } from "../src/game/actions/give";
import { buildInspectTool, parseInspect } from "../src/game/actions/inspect";
import { buildLootTool, parseLoot } from "../src/game/actions/loot";
import { buildMoveTool, parseMove } from "../src/game/actions/move";
import { buildPickupTool, parsePickup } from "../src/game/actions/pickup";
import { buildSayTool, parseSay } from "../src/game/actions/say";
import { buildStealTool, parseSteal } from "../src/game/actions/steal";
import { buildStrikeTool, parseStrike } from "../src/game/actions/strike";
import { buildTeleportTool, parseTeleport } from "../src/game/actions/teleport";
import { buildUnequipTool, parseUnequip } from "../src/game/actions/unequip";
import { buildUseTool, parseUse } from "../src/game/actions/use";
import { buildWaitTool, parseWait } from "../src/game/actions/wait";
import { buildWhisperTool, parseWhisper } from "../src/game/actions/whisper";
import { describeSelf, describeStats } from "../src/game/agents/actor-turn";
import { formatForm } from "../src/game/agents/appearance/form";
import { parseEndGame } from "../src/game/agents/world-turn";
import { describeEquipment, describeItems, toItemState } from "../src/game/item-state";
import { itemNamesWithTrigger } from "../src/game/kernel/affixes";
import { describeStageAnchors, stageItemNames } from "../src/game/stage-state";

describe("action authorization", () => {
  it("权限报错直接写实体的名字", () => {
    expect(() => assertActionAllowed([], "strike", "奥德里克")).toThrow(
      "奥德里克不能使用动作: strike",
    );
  });
});

describe("action tools", () => {
  it("每类动作都是独立工具，参数即它的全部输入", () => {
    const targets = ["提灯修士"];
    const stages = ["断钟中殿"];
    const items = ["裂齿短刃"];

    expect(buildSayTool(targets).function.name).toBe("say");
    expect(buildSayTool(targets).function.parameters.required).toEqual([
      "mind",
      "targetActorHandle",
      "message",
    ]);
    expect(buildWhisperTool(targets).function.name).toBe("whisper");
    expect(buildAnnounceTool().function.parameters.required).toEqual(["mind", "message"]);
    expect(buildCallTool().function.parameters.required).toEqual([
      "mind",
      "targetActorName",
      "message",
    ]);
    expect(buildMoveTool(stages).function.parameters.required).toEqual(["targetStageName"]);
    expect(buildTeleportTool().function.parameters.required).toEqual(["targetStageName"]);
    expect(buildTeleportTool().function.parameters.properties).not.toMatchObject({
      targetStageName: { enum: expect.anything() },
    });
    expect(buildWaitTool().function.parameters.required).toEqual([]);
    expect(buildStrikeTool(targets).function.parameters.required).toEqual(["targetActorHandle"]);
    // 横扫是列表入参：required 只有 targets，上限由武器给出的 maxTargets 写进形状。
    expect(buildCleaveTool(targets, 3).function.parameters.required).toEqual(["targets"]);
    const cleaveTargets = (maxTargets: number) =>
      (
        buildCleaveTool(targets, maxTargets).function.parameters.properties as Record<
          string,
          unknown
        >
      ).targets;
    expect(cleaveTargets(3)).toMatchObject({ type: "array", minItems: 1, maxItems: 3 });
    expect(cleaveTargets(2)).toMatchObject({ maxItems: 2 });
    expect(buildBrawlTool(targets).function.parameters.required).toEqual(["targetActorHandle"]);
    expect(buildStealTool(targets).function.parameters.required).toEqual([
      "targetActorHandle",
      "itemName",
    ]);
    // 查看行囊只有一个目标参数，对象是谁由参数名说明。
    expect(buildInspectTool(targets).function.parameters.required).toEqual(["targetActorHandle"]);
    // 搜刮的 itemNames 是可选的：不传就是搬空尸体。
    expect(buildLootTool(targets).function.parameters.required).toEqual(["targetActorHandle"]);
    expect(buildGiveTool(targets).function.parameters.required).toEqual([
      "targetActorHandle",
      "itemName",
    ]);
    expect(buildPickupTool().function.parameters.required).toEqual(["targetAnchor", "itemName"]);
    expect(buildUseTool(items, targets, "灰烬门廊").function.parameters.required).toEqual([
      "itemName",
    ]);
    expect(buildEquipTool(items).function.parameters.required).toEqual(["itemName", "slot"]);
    expect(buildUnequipTool(["weapon"]).function.parameters.required).toEqual(["slot"]);

    // 每个工具的参数就是它自己的输入，没有中间层字段。
    const strikeProps = Object.keys(buildStrikeTool(targets).function.parameters.properties ?? {});
    expect(strikeProps).toEqual(["targetActorHandle"]);
    expect(Object.keys(buildBrawlTool(targets).function.parameters.properties ?? {})).toEqual([
      "targetActorHandle",
    ]);
    const useProps = Object.keys(
      buildUseTool(items, targets, "灰烬门廊").function.parameters.properties ?? {},
    );
    expect(useProps).toEqual(["itemName", "targetActorHandle", "targetStageName"]);
    const anchoredUse = buildUseTool(items, targets, "灰烬门廊", ["门闩"]);
    expect(Object.keys(anchoredUse.function.parameters.properties ?? {})).toEqual([
      "itemName",
      "targetActorHandle",
      "targetStageName",
      "targetAnchor",
    ]);
    const anchoredProps = anchoredUse.function.parameters.properties as Record<
      string,
      { enum?: string[] }
    >;
    expect(anchoredProps.targetAnchor).toMatchObject({ enum: ["门闩"] });
    expect(Object.keys(buildEquipTool(items).function.parameters.properties ?? {})).toEqual([
      "itemName",
      "slot",
    ]);
  });
});

describe("use candidates", () => {
  const useAffixes = (affixKind: string) => {
    if (affixKind === "damage") {
      return {
        use: [
          {
            name: "造成伤害",
            content: "造成 {{attack}} 点伤害",
            ops: [{ kind: "damage" as const, amount: { ref: "attack" as const } }],
          },
        ],
      };
    }
    if (affixKind === "witness") {
      return {
        use: [
          {
            name: "使用",
            content: "使用道具",
            ops: [{ kind: "witness" as const, template: "{source}使用了{item}" }],
          },
        ],
      };
    }
    return {};
  };
  const item = (name: string, kind: "weapon" | "valuable" | "material", affixKind: string) =>
    toItemState({
      id: name,
      seq: 1,
      name,
      description: `${name} 的描述`,
      kind,
      count: 1,
      stats: { maxHp: 0, strength: 0, wisdom: 0, agility: 0, damage: 0, block: 0 },
      affixes: useAffixes(affixKind),
      actions: [],
    });

  it("按触发词缀取候选：在不在槽里无关", () => {
    const candidates = itemNamesWithTrigger(
      [
        item("裂齿短刃", "weapon", "damage"),
        item("闸门钥匙", "valuable", "witness"),
        item("碎骨", "material", "none"),
      ],
      "use",
    );
    expect(candidates).toEqual(["裂齿短刃", "闸门钥匙"]);
    // 名单与触发同源：换个触发不需要再写一份取名单的代码。
    expect(itemNamesWithTrigger([item("裂齿短刃", "weapon", "damage")], "fit")).toEqual([]);
  });
});

describe("action parsers", () => {
  it("只检查形状，产出平铺动作", () => {
    expect(
      parseSay({ mind: "问一句。", targetActorHandle: "提灯修士", message: "钟声？" }),
    ).toEqual({
      kind: "say",
      mind: "问一句。",
      targetActorHandle: "提灯修士",
      message: "钟声？",
    });
    expect(
      parseWhisper({ mind: "低声。", targetActorHandle: "提灯修士", message: "别回头。" }),
    ).toMatchObject({ kind: "whisper" });
    expect(parseAnnounce({ mind: "让所有人听见。", message: "灰里有人。" })).toEqual({
      kind: "announce",
      mind: "让所有人听见。",
      message: "灰里有人。",
    });
    expect(
      parseCall({
        mind: "他还在中殿。",
        targetActorName: "缄默抄经人",
        message: "钟声还在吗？",
      }),
    ).toEqual({
      kind: "call",
      mind: "他还在中殿。",
      targetActorName: "缄默抄经人",
      message: "钟声还在吗？",
    });
    expect(() =>
      parseCall({
        mind: "他还在中殿。",
        targetActorName: "#12",
        message: "钟声还在吗？",
      }),
    ).toThrow(/必须使用真名/);
    expect(parseMove({ targetStageName: "断钟中殿" })).toEqual({
      kind: "move",
      targetStageName: "断钟中殿",
    });
    expect(parseTeleport({ targetStageName: " 断钟中殿 " })).toEqual({
      kind: "teleport",
      targetStageName: "断钟中殿",
    });
    expect(() => parseTeleport({ targetStageName: "#12" })).toThrow(/真名/);
    expect(parseWait()).toEqual({ kind: "wait" });
    // strike 不再接收道具名：武器由 weapon 槽决定。
    expect(parseStrike({ targetActorHandle: " 提灯修士 ", itemName: "裂齿短刃" })).toEqual({
      kind: "strike",
      targetActorHandle: "提灯修士",
    });
    // 肉搏同样只接收目标：身体不是道具，没有可指定的武器。
    expect(parseBrawl({ targetActorHandle: " 提灯修士 ", itemName: "裂齿短刃" })).toEqual({
      kind: "brawl",
      targetActorHandle: "提灯修士",
    });
    // 横扫接收目标列表；数量上限不在语法层，由武器的 maxTargets 在结算端复核。
    expect(parseCleave({ targets: [" 提灯修士 ", "#3"] })).toEqual({
      kind: "cleave",
      targetActorHandles: ["提灯修士", "#3"],
    });
    expect(() => parseCleave({ targets: [] })).toThrow(/targets/);
    expect(() => parseCleave({ targets: ["提灯修士", "  "] })).toThrow(/targets/);
    expect(() => parseCleave({ targetActorHandle: "提灯修士" })).toThrow(/targets/);
    expect(parseEquip({ itemName: " 裂齿短刃 ", slot: " weapon " })).toEqual({
      kind: "equip",
      itemName: "裂齿短刃",
      slot: "weapon",
    });
    expect(parseUnequip({ slot: "armor" })).toEqual({ kind: "unequip", slot: "armor" });
    expect(() => parseUnequip({ slot: "head" })).toThrow("未知的装备槽位");
    expect(parseSteal({ targetActorHandle: "提灯修士", itemName: "铅封提灯" })).toEqual({
      kind: "steal",
      targetActorHandle: "提灯修士",
      itemName: "铅封提灯",
    });
    expect(parseInspect({ targetActorHandle: " 提灯修士 " })).toEqual({
      kind: "inspect",
      targetActorHandle: "提灯修士",
    });
    expect(() => parseInspect({ targetActorHandle: "  " })).toThrow(/targetActorHandle/);
    expect(parseLoot({ targetActorHandle: "提灯修士" })).toEqual({
      kind: "loot",
      targetActorHandle: "提灯修士",
    });
    expect(parseLoot({ targetActorHandle: " 提灯修士 ", itemNames: [" 铅封提灯 "] })).toEqual({
      kind: "loot",
      targetActorHandle: "提灯修士",
      itemNames: ["铅封提灯"],
    });
    // 空列表与省略等价：都是搜刮全部。
    expect(parseLoot({ targetActorHandle: "提灯修士", itemNames: [] })).toEqual({
      kind: "loot",
      targetActorHandle: "提灯修士",
    });
    expect(() => parseLoot({ itemNames: ["铅封提灯"] })).toThrow(/targetActorHandle/);
    expect(() =>
      parseLoot({ targetActorHandle: "提灯修士", itemNames: ["铅封提灯", "铅封提灯"] }),
    ).toThrow(/不能重复/);
    expect(parseGive({ targetActorHandle: "提灯修士", itemName: "裂齿短刃" })).toEqual({
      kind: "give",
      targetActorHandle: "提灯修士",
      itemName: "裂齿短刃",
    });
    expect(parsePickup({ targetAnchor: "墙角", itemName: "测试火把" })).toEqual({
      kind: "pickup",
      targetAnchor: "墙角",
      itemName: "测试火把",
    });
    expect(
      parseUse({
        itemName: "闸门钥匙",
        targetStageName: "铁闸门",
        targetAnchor: "锁孔",
      }),
    ).toEqual({
      kind: "use",
      itemName: "闸门钥匙",
      targetStageName: "铁闸门",
      targetAnchor: "锁孔",
    });
  });

  it("拒绝缺参数或参数冲突的调用", () => {
    expect(() => parseSay({ mind: "", targetActorHandle: "提灯修士", message: "喂" })).toThrow(
      "mind",
    );
    expect(() => parseSay({ mind: "说。", targetActorHandle: " ", message: "喂" })).toThrow(
      "targetActorHandle",
    );
    expect(() => parseSay({ mind: "说。", targetActorHandle: "提灯修士", message: "  " })).toThrow(
      "message",
    );
    expect(() => parseMove({ targetStageName: "" })).toThrow("targetStageName");
    expect(() =>
      parseUse({ itemName: "钥匙", targetActorHandle: "守烬人", targetAnchor: "锁孔" }),
    ).toThrow("targetAnchor");
    expect(() => parseStrike({ targetActorHandle: "  " })).toThrow("targetActorHandle");
    expect(() => parseBrawl({ targetActorHandle: "  " })).toThrow("targetActorHandle");
    expect(() => parseSteal({ targetActorHandle: "提灯修士" })).toThrow("itemName");
    expect(() => parsePickup({ itemName: "测试火把" })).toThrow("targetAnchor");
    expect(() => parsePickup({ targetAnchor: "墙角" })).toThrow("itemName");
    expect(() => parseUse({ itemName: "钥匙" })).toThrow("targetActorHandle 或 targetStageName");
    expect(() =>
      parseUse({ itemName: "钥匙", targetActorHandle: "提灯修士", targetStageName: "铁闸门" }),
    ).toThrow("二选一");
    // 具体是否为当前舞台锚点由 resolveUse 校验；parseUse 只负责形状。
    expect(parseUse({ itemName: "钥匙", targetStageName: "铁闸门", targetAnchor: "锁孔" })).toEqual(
      {
        kind: "use",
        itemName: "钥匙",
        targetStageName: "铁闸门",
        targetAnchor: "锁孔",
      },
    );
  });
});

describe("world action parsers", () => {
  it("end_game 的结局标签由 world 自己命名，只要非空", () => {
    expect(parseEndGame({ outcome: "逃出修道院", message: "门在身后合上了。" })).toEqual({
      kind: "end_game",
      outcome: "逃出修道院",
      message: "门在身后合上了。",
    });
    expect(() => parseEndGame({ message: "门在身后合上了。" })).toThrow(/outcome/);
    expect(() => parseEndGame({ outcome: "", message: "门在身后合上了。" })).toThrow(/outcome/);
  });
});

describe("read-only descriptions", () => {
  it("renders own stats and items", () => {
    const actor = {
      id: "actor-1",
      seq: 1,
      key: "ember-keeper",
      name: "守烬人",
      profile: "拾荒者",
      appearance: { id: "appearance-1", text: "披着旧斗篷。" },
      signature: {
        id: "signature-1",
        seq: 2,
        form: formatForm("人类", "瘦削，手腕有旧绳痕。"),
      },
      hp: 12,
      stats: { maxHp: 12, strength: 3, wisdom: 2, agility: 4, damage: 0, block: 0 },
      isDefaultPlayer: false,
      equipment: { weapon: "裂齿短刃" },
      knowledgeAccess: [],
      actions: ["say", "whisper", "announce", "move", "wait", "give", "pickup"] as const,
      items: [
        {
          id: "item-1",
          seq: 2,
          key: "cracked-blade",
          name: "裂齿短刃",
          description: "刃口崩了三处。",
          kind: "weapon" as const,
          count: 1,
          maxTargets: 1,
          stats: { maxHp: 0, strength: 0, wisdom: 0, agility: 0, damage: 3, block: 0 },
          affixes: {
            strike: [
              {
                name: "裂齿",
                content: "造成 {{attack}} 点伤害",
                ops: [{ kind: "damage" as const, amount: { ref: "attack" as const } }],
              },
            ],
          },
          actions: ["strike" as const],
          appearsInAppearance: false,
        },
      ],
    };

    expect(describeStats(actor)).toContain("HP：12/12");
    // 面板与结算同口径：伤害 = 力量现算 3 + 武器终值 3，格挡只来自装备（这里没穿护甲）。
    expect(describeStats(actor)).toContain("力量：3");
    expect(describeStats(actor)).toContain("敏捷：4");
    expect(describeStats(actor)).toContain("伤害：6");
    expect(describeStats(actor)).toContain("格挡：0");
    // attack / defense 保留在数据里，但不再对外展示。
    expect(describeStats(actor)).not.toContain("attack：");
    expect(describeStats(actor)).not.toContain("defense：");
    expect(describeStats(actor)).toContain("状态：存活");
    expect(describeItems(actor)).toContain("裂齿短刃（weapon，count 1，已穿戴）：刃口崩了三处。");
    // 道具数值同样用中文名，不再出现 damage / block。
    expect(describeItems(actor)).toContain("伤害 3");
    expect(describeItems(actor)).not.toContain("damage ");
    expect(describeItems({ items: [], equipment: {} })).toBe("道具：无");
    expect(describeEquipment(actor)).toContain("武器：裂齿短刃");
    expect(describeSelf(actor)).toContain("外观：披着旧斗篷。");
    expect(describeSelf(actor)).toContain("裂齿短刃");

    // 材料多带一个来源；其它大类不展示这个字段。
    const bag = {
      ...actor,
      items: [
        ...actor.items,
        {
          id: "item-2",
          seq: 3,
          key: "material:灰烬骨片",
          name: "灰烬骨片",
          description: "碎得只剩边角。",
          kind: "material" as const,
          source: "提灯修士",
          count: 2,
          maxTargets: 1,
          stats: { maxHp: 0, strength: 0, wisdom: 0, agility: 0, damage: 0, block: 0 },
          affixes: {},
          actions: [],
          appearsInAppearance: false,
        },
      ],
    };
    expect(describeItems(bag)).toContain("灰烬骨片（material，count 2，源自 提灯修士）");
    expect(describeItems(bag)).not.toContain("裂齿短刃（weapon，count 1，源自");
  });
});

describe("stage anchors", () => {
  it("把道具渲染在锚点下面，并给出可拾取名", () => {
    const torch = toItemState({
      id: "item-1",
      seq: 7,
      key: "torch",
      name: "松脂火把",
      description: "一支浸透松脂的火把。",
      kind: "weapon",
      count: 1,
      stats: { maxHp: 0, strength: 0, wisdom: 0, agility: 0, damage: 8, block: 0 },
    });
    const anchors = [
      { key: "corner", label: "墙角", description: "炉门旁的墙角。", items: [torch] },
      { key: "lock", label: "锁孔", items: [] },
    ];

    const text = describeStageAnchors(anchors);
    expect(text).toContain("- 墙角：炉门旁的墙角。");
    expect(text).toContain("  - 松脂火把（weapon）：一支浸透松脂的火把。");
    expect(text).toContain("- 锁孔");
    expect(stageItemNames({ anchors })).toEqual(["松脂火把"]);
  });
});
