import { describe, expect, it } from "vitest";
import { BELL_MONASTERY_KNOWLEDGE, BELL_MONASTERY_WORLD } from "../seeds/dark-fantasy";
import { resolveAppearance } from "../src/game/body";
import { buildWorldSystemPrompt } from "../src/game/memory";

const { stages } = BELL_MONASTERY_WORLD;

function stage(key: string) {
  const found = stages.find((candidate) => candidate.key === key);
  if (!found) {
    throw new Error(`缺少 stage: ${key}`);
  }
  return found;
}

describe("dark fantasy seed world", () => {
  it("keeps the six-stage monastery story", () => {
    expect(stages.map((item) => item.name)).toEqual([
      "场景.墓园",
      "场景.棺材",
      "场景.地窖",
      "场景.焚尸房",
      "场景.铁闸门",
      "场景.山道",
    ]);
    expect(BELL_MONASTERY_WORLD.worldName).toBe("世界.枯钟修道院的故事");
    // 开局完全由棺材的 environment 与角色自己的记忆表达，没有单独的开场文本。
    expect(BELL_MONASTERY_WORLD.actors.filter((actor) => actor.isDefaultPlayer)).toHaveLength(1);
    expect(BELL_MONASTERY_WORLD.actors.map((actor) => actor.name)).toEqual([
      "角色.奥德里克",
      "角色.煤渣",
      "角色.坏运气",
      "角色.无名者",
      "角色.鼠王",
    ]);
  });

  it("places the actors in the monastery and keeps the fire weapon", () => {
    expect(
      BELL_MONASTERY_WORLD.actors.filter((actor) => actor.stageKey === "graveyard"),
    ).toHaveLength(3);
    expect(BELL_MONASTERY_WORLD.actors.filter((actor) => actor.stageKey === "coffin")).toHaveLength(
      1,
    );
    expect(BELL_MONASTERY_WORLD.actors.filter((actor) => actor.stageKey === "cellar")).toHaveLength(
      1,
    );
    expect(stage("crematorium").items?.map((item) => item.name)).toEqual(["武器.松脂火把"]);
    expect(stage("crematorium").items?.[0]).toMatchObject({
      key: "crematorium-torch",
      kind: "weapon",
      count: 1,
      stats: { damage: 8, block: 0 },
      affixes: ["火焰顺着毛根渗进去：对多毛类生物额外造成武器伤害的一百倍，毛越厚烧得越透"],
    });
    expect(stage("gate").items ?? []).toEqual([]);
  });

  it("gives the keeper the gate key and makes the rat king a lethal sleeper", () => {
    const keeper = BELL_MONASTERY_WORLD.actors.find((actor) => actor.name === "角色.奥德里克");
    const king = BELL_MONASTERY_WORLD.actors.find((actor) => actor.name === "角色.鼠王");
    expect(keeper?.items.map((item) => item.name)).toEqual(
      expect.arrayContaining(["物品.闸门钥匙", "武器.掘墓人的铁锹", "装备.补丁斗篷"]),
    );
    expect(keeper?.equipment).toEqual({
      weapon: "武器.掘墓人的铁锹",
      armor: "装备.补丁斗篷",
    });
    expect(keeper?.items.find((item) => item.name === "装备.补丁斗篷")).toMatchObject({
      key: "patched-cloak",
      kind: "equipment",
      stats: { block: 1 },
    });
    // 钥匙是剧情道具（valuable），不在穿戴槽里，所以活着时也能被窃取。
    expect(keeper?.items.find((item) => item.name === "物品.闸门钥匙")).toMatchObject({
      key: "gate-key",
      kind: "valuable",
    });
    expect(keeper?.baseBody.race).toBe("人类");
    expect(keeper?.hp).toBe(14);
    const defaultPlayers = BELL_MONASTERY_WORLD.actors
      .filter((actor) => actor.isDefaultPlayer)
      .map((actor) => actor.name);
    expect(defaultPlayers).toEqual(["角色.无名者"]);
    expect(king?.baseBody.race).toBe("鼠");
    expect(king?.hp).toBeGreaterThan(keeper?.hp ?? 0);
    expect(king?.stats.damage).toBeGreaterThan(20);
    expect(king?.stats.block).toBeGreaterThan(king?.stats.damage ?? 0);
    expect(king?.profile).not.toContain("沉睡在地窖");
    expect(king?.openingBriefing).toContain("你正沉睡在地窖");
    expect(king?.openingBriefing).toContain("苏醒前你只能留在原地");
  });

  it("keeps human appearance clothed and lets animals fall back to base body", () => {
    const keeper = BELL_MONASTERY_WORLD.actors.find((actor) => actor.name === "角色.奥德里克");
    const king = BELL_MONASTERY_WORLD.actors.find((actor) => actor.name === "角色.鼠王");
    if (!king) {
      throw new Error("缺少鼠王");
    }
    expect(keeper?.appearance).toContain("斗篷");
    expect(king.appearance).toBeUndefined();
    expect(resolveAppearance(king)).toBe(king.baseBody.description);
  });

  it("encodes the plague backstory in the world text", () => {
    expect(stage("coffin").environment).toContain("石灰");
    const player = BELL_MONASTERY_WORLD.actors.find((actor) => actor.isDefaultPlayer);
    expect(player?.appearance).toContain("裹尸布");
    expect(stage("coffin").profile).toContain("黑疖病");
    expect(stage("crematorium").profile).toContain("黑疖病");
    const keeper = BELL_MONASTERY_WORLD.actors.find((actor) => actor.name === "角色.奥德里克");
    expect(keeper?.profile).toContain("黑疖病");
    expect(keeper?.profile).toContain("旧钟无名");
  });

  it("makes the coffin a one-way start that hints at the player's oddity", () => {
    const coffin = stage("coffin");
    // 符文是主角特殊性的伏笔，但不能直接交出铁闸门的暗语。
    expect(coffin.environment).toContain("符文");
    expect(coffin.environment).toContain("钟形花纹");
    expect(`${coffin.profile}${coffin.environment}`).not.toContain("旧钟无名");
    // 棺材是唯一入口，且只能出不能进。
    const edges = BELL_MONASTERY_WORLD.connections.map(
      (connection) => `${connection.from}->${connection.to}`,
    );
    expect(edges.filter((edge) => edge.endsWith("->coffin"))).toEqual([]);
    expect(edges).toContain("coffin->graveyard");
  });

  it("declares per-actor actions explicitly in the seed", () => {
    const actionsOf = (name: string) => [
      ...(BELL_MONASTERY_WORLD.actors.find((actor) => actor.name === name)?.actions ?? []),
    ];

    const TALK_AND_MOVE = ["say", "whisper", "announce", "move", "wait"];
    const ITEM_ACTIONS = ["give", "pickup", "use"];

    // 活物都会说话、走动与等待。
    for (const actor of BELL_MONASTERY_WORLD.actors) {
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

    // 所有场景都必须能更新 environment；只有山道能向 world 报告，
    // 只有铁闸门能改变与门外的连通性。
    for (const item of stages) {
      expect(item.actions).toContain("submit_environment");
      if (item.key !== "mountain-path") {
        expect(item.actions).not.toContain("notify_world");
      }
    }
    expect(stage("gate").actions).toEqual(["submit_environment", "open_passage"]);
    expect(stage("mountain-path").actions).toEqual(["submit_environment", "notify_world"]);
    expect(BELL_MONASTERY_WORLD.actions).toEqual(["notify_stage", "end_game"]);
  });

  it("gives the world its own profile and keeps ending rules generic", () => {
    const profile = BELL_MONASTERY_WORLD.profile;
    expect(profile).toContain("这局故事的世界是枯钟修道院");
    // 工具名只出现在任务提示词构建里；内容不能与工具名耦合。
    expect(profile).not.toContain("end_game");
    expect(profile).not.toContain("notify_stage");
    expect(BELL_MONASTERY_WORLD.systemRules).toContain("### 收束与结束");
    // 全局规则同时进 actor / stage / world 的 system prompt，所以不能写成「你」。
    expect(BELL_MONASTERY_WORLD.systemRules).toContain("只有世界能结束游戏");
    expect(BELL_MONASTERY_WORLD.systemRules).not.toContain("只有你能结束游戏");
    const prompt = buildWorldSystemPrompt(BELL_MONASTERY_WORLD);
    expect(prompt).toContain("## 世界设定");
    expect(prompt).toContain("主角倒下时你会收到通知");
  });

  it("puts animal language rules in profiles, not in global rules", () => {
    const rules = BELL_MONASTERY_WORLD.systemRules;
    expect(rules).not.toContain("种族语言与发声");
    expect(rules).not.toContain("动物只能与同族");
    expect(rules).not.toContain("鼠王对非同族");

    const dog = BELL_MONASTERY_WORLD.actors.find((actor) => actor.name === "角色.煤渣");
    const pup = BELL_MONASTERY_WORLD.actors.find((actor) => actor.name === "角色.坏运气");
    const king = BELL_MONASTERY_WORLD.actors.find((actor) => actor.name === "角色.鼠王");
    expect(dog?.profile).toContain("汪汪");
    expect(dog?.profile).toContain("内心独白不受叫声限制");
    expect(pup?.profile).toContain("吱吱、丝丝");
    expect(pup?.profile).toContain("对非同族只会");
    expect(pup?.profile).toContain("内心独白不受叫声限制");
    expect(king?.profile).toContain("对非同族只会发出低沉的鼠叫");
    expect(king?.profile).toContain("绝不说人话");
    expect(king?.profile).toContain("内心独白不受叫声限制");
    expect(king?.openingBriefing).toContain("本场景内每一个非鼠类活物都必须被你杀死");
    expect(king?.openingBriefing).not.toContain("wait");
    expect(king?.openingBriefing).not.toContain("墓园 → 焚尸房");
  });

  it("keeps the public knowledge base free of actor secrets", () => {
    const text = Object.values(BELL_MONASTERY_KNOWLEDGE).flat().join("\n");
    for (const actor of BELL_MONASTERY_WORLD.actors) {
      expect(text).not.toContain(actor.name);
    }
    for (const secret of ["钥匙", "秘密", "弱点", "沉睡", "追杀"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("connects the graveyard, coffin, cellar, crematorium, gate and mountain path", () => {
    const edges = new Set(
      BELL_MONASTERY_WORLD.connections.map((connection) => `${connection.from}->${connection.to}`),
    );
    expect([...edges].sort()).toEqual(
      [
        "coffin->graveyard",
        "graveyard->cellar",
        "cellar->graveyard",
        "graveyard->crematorium",
        "crematorium->graveyard",
        "graveyard->gate",
        "gate->graveyard",
        "gate->mountain-path",
      ].sort(),
    );
  });

  it("keeps the way out sealed until the gate stage opens it", () => {
    const wayOut = BELL_MONASTERY_WORLD.connections.find(
      (connection) => connection.from === "gate" && connection.to === "mountain-path",
    );
    expect(wayOut?.passage).toBe("sealed");
    // 单向：逃出修道院后没有回头路。
    expect(
      BELL_MONASTERY_WORLD.connections.some(
        (connection) => connection.from === "mountain-path" && connection.to === "gate",
      ),
    ).toBe(false);
  });
});
