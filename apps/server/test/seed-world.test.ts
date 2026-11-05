import { describe, expect, it } from "vitest";
import { BELL_MONASTERY_KNOWLEDGE, BELL_MONASTERY_WORLD } from "../seeds/dark-fantasy";
import { resolveAppearance } from "../src/game/form";
import { buildWorldSystemPrompt } from "../src/game/memory";
import { parseWorldContent } from "../src/game/parse-world-content";

const { stages } = BELL_MONASTERY_WORLD;

function stage(key: string) {
  const found = stages.find((candidate) => candidate.key === key);
  if (!found) {
    throw new Error(`缺少 stage: ${key}`);
  }
  return found;
}

describe("dark fantasy seed world", () => {
  it("keeps the seven-stage monastery story", () => {
    expect(stages.map((item) => item.name)).toEqual([
      "墓园",
      "棺材",
      "地窖",
      "钟窖",
      "焚尸房",
      "铁闸门",
      "山道",
    ]);
    expect(BELL_MONASTERY_WORLD.worldName).toBe("枯钟修道院的故事");
    // 开局完全由棺材的 environment 与角色自己的记忆表达，没有单独的开场文本。
    expect(BELL_MONASTERY_WORLD.actors.filter((actor) => actor.isDefaultPlayer)).toHaveLength(1);
    expect(BELL_MONASTERY_WORLD.actors.map((actor) => actor.name)).toEqual([
      "奥德里克",
      "小狗“煤渣”",
      "小鼠“坏运气”",
      "无名者",
      "鼠王",
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
    expect(stage("crematorium").anchors?.[0]?.items?.map((item) => item.name)).toEqual([
      "松脂火把",
    ]);
    expect(stage("crematorium").anchors?.[0]?.items?.[0]).toMatchObject({
      key: "crematorium-torch",
      kind: "weapon",
      count: 1,
      stats: { damage: 8, block: 0 },
      affixes: [
        {
          name: "松脂渗毛",
          content: "火焰顺着毛根渗进去：对多毛类生物额外造成武器伤害的一百倍，毛越厚烧得越透",
        },
      ],
    });
    expect(stage("gate").anchors?.flatMap((anchor) => anchor.items ?? []) ?? []).toEqual([]);
  });

  it("gives the keeper the gate key and makes the rat king a lethal sleeper", () => {
    const keeper = BELL_MONASTERY_WORLD.actors.find((actor) => actor.name === "奥德里克");
    const king = BELL_MONASTERY_WORLD.actors.find((actor) => actor.name === "鼠王");
    expect(keeper?.items.map((item) => item.name)).toEqual(
      expect.arrayContaining(["闸门钥匙", "掘墓人的铁锹", "补丁斗篷"]),
    );
    expect(keeper?.equipment).toEqual({
      weapon: "掘墓人的铁锹",
      armor: "补丁斗篷",
    });
    expect(keeper?.items.find((item) => item.name === "补丁斗篷")).toMatchObject({
      key: "patched-cloak",
      kind: "equipment",
      stats: { block: 1 },
    });
    // 钥匙是剧情道具（valuable），不在穿戴槽里，所以活着时也能被窃取。
    expect(keeper?.items.find((item) => item.name === "闸门钥匙")).toMatchObject({
      key: "gate-key",
      kind: "valuable",
    });
    expect(keeper?.signature.form.startsWith("人类:")).toBe(true);
    expect(keeper?.hp).toBe(14);
    const defaultPlayers = BELL_MONASTERY_WORLD.actors
      .filter((actor) => actor.isDefaultPlayer)
      .map((actor) => actor.name);
    expect(defaultPlayers).toEqual(["无名者"]);
    // 鼠王随身收着旧钟的钟舌：valuable + event，不是身体材料。
    expect(king?.items.find((item) => item.name === "旧钟的钟舌")).toMatchObject({
      key: "rat-king-clapper",
      kind: "valuable",
      effect: { type: "event" },
    });
    expect(king?.signature.form.startsWith("鼠:")).toBe(true);
    expect(king?.hp).toBeGreaterThan(keeper?.hp ?? 0);
    expect(king?.stats.damage).toBeGreaterThan(20);
    expect(king?.stats.block).toBeGreaterThan(king?.stats.damage ?? 0);
    expect(king?.profile).not.toContain("沉睡在地窖");
    expect(king?.openingBriefing).toContain("你正沉睡在地窖");
    expect(king?.openingBriefing).toContain("苏醒前你只能留在原地");
  });

  it("keeps human appearance clothed and lets animals fall back to the form", () => {
    const keeper = BELL_MONASTERY_WORLD.actors.find((actor) => actor.name === "奥德里克");
    const king = BELL_MONASTERY_WORLD.actors.find((actor) => actor.name === "鼠王");
    if (!king) {
      throw new Error("缺少鼠王");
    }
    expect(keeper?.signature.appearance).toContain("斗篷");
    expect(king.signature.appearance).toBeUndefined();
    expect(resolveAppearance(king.signature)).toBe(king.signature.form);
  });

  it("encodes the plague backstory in the world text", () => {
    expect(stage("coffin").environment).toContain("石灰");
    const player = BELL_MONASTERY_WORLD.actors.find((actor) => actor.isDefaultPlayer);
    expect(player?.signature.appearance).toContain("裹尸布");
    expect(stage("coffin").profile).toContain("黑疖病");
    expect(stage("crematorium").profile).toContain("黑疖病");
    const keeper = BELL_MONASTERY_WORLD.actors.find((actor) => actor.name === "奥德里克");
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
    for (const animal of ["小狗“煤渣”", "小鼠“坏运气”", "鼠王"]) {
      for (const action of [...ITEM_ACTIONS, "steal"]) {
        expect(actionsOf(animal)).not.toContain(action);
      }
    }

    // 挥击由武器提供，不再是角色固有动作；肉搏是固有动作，按角色显式声明。
    for (const actor of BELL_MONASTERY_WORLD.actors) {
      expect(actionsOf(actor.name)).not.toContain("strike");
    }
    for (const fighter of ["奥德里克", "无名者", "小狗“煤渣”", "鼠王"]) {
      expect(actionsOf(fighter)).toContain("brawl");
    }
    expect(actionsOf("小鼠“坏运气”")).not.toContain("brawl");
    const weaponActions = (itemName: string) => {
      const item = BELL_MONASTERY_WORLD.actors
        .flatMap((actor) => actor.items)
        .concat(
          BELL_MONASTERY_WORLD.stages.flatMap((stage) =>
            (stage.anchors ?? []).flatMap((anchor) => anchor.items ?? []),
          ),
        )
        .find((candidate) => candidate.name === itemName);
      return [...(item?.actions ?? [])];
    };
    expect(weaponActions("掘墓人的铁锹")).toEqual(["strike"]);
    expect(weaponActions("松脂火把")).toEqual(["strike"]);

    // 人类可以操作道具；偷窃只属于无名者。
    for (const human of ["奥德里克", "无名者"]) {
      for (const action of ITEM_ACTIONS) {
        expect(actionsOf(human)).toContain(action);
      }
    }
    expect(actionsOf("无名者")).toContain("steal");
    expect(actionsOf("奥德里克")).not.toContain("steal");

    // 所有场景都必须能更新 environment；向 world 报告的只有山道、地窖与钟窖，
    // 能改变连通性的只有铁闸门与地窖。
    const reporting = new Set(["mountain-path", "cellar", "bell-crypt"]);
    for (const item of stages) {
      expect(item.actions).toContain("submit_environment");
      if (!reporting.has(item.key)) {
        expect(item.actions).not.toContain("notify_world");
      }
    }
    expect(stage("gate").actions).toEqual([
      "submit_environment",
      "open_passage",
      "add_anchor",
      "remove_anchor",
      "update_anchor",
    ]);
    expect(stage("mountain-path").actions).toEqual([
      "submit_environment",
      "notify_world",
      "add_anchor",
      "remove_anchor",
      "update_anchor",
    ]);
    expect(stage("graveyard").anchors).toEqual([
      { key: "lock", label: "锁孔", description: "铁闸门上被干蜡塞住的锁孔。" },
    ]);
    expect(stage("gate").anchors).toEqual([
      { key: "lock", label: "锁孔", description: "铁闸门上被干蜡塞住的锁孔。" },
    ]);
    expect(stage("cellar").actions).toEqual([
      "submit_environment",
      "notify_world",
      "open_passage",
      "add_anchor",
      "remove_anchor",
      "update_anchor",
    ]);
    expect(stage("cellar").anchors).toEqual([
      {
        key: "altar",
        label: "祭坛",
        description: "地窖后墙前的矮石台，台面刻着钟形纹，正中一道铜舌粗细的凹槽。",
      },
    ]);
    // 钟窖才是向 world 报告源头的地方。
    expect(stage("bell-crypt").actions).toEqual([
      "submit_environment",
      "notify_world",
      "add_anchor",
      "remove_anchor",
      "update_anchor",
    ]);
    expect(BELL_MONASTERY_WORLD.actions).toEqual(["notify_stage", "end_game"]);
  });

  it("gives the world its own profile and leaves ending rules to it", () => {
    const profile = BELL_MONASTERY_WORLD.profile;
    expect(profile).toContain("这局故事的世界是枯钟修道院");
    // 工具名只出现在任务提示词构建里；内容不能与工具名耦合。
    expect(profile).not.toContain("end_game");
    expect(profile).not.toContain("notify_stage");
    // 收束条件属于世界设定；全局规则只定边界，不重复具体玩法。
    expect(profile).toContain("有且只有三种收尾");
    const prompt = buildWorldSystemPrompt(BELL_MONASTERY_WORLD);
    expect(prompt).toContain("## 本局世界");
    expect(prompt).toContain("主角倒下只是通知");
  });

  it("puts animal language rules in profiles, not in global rules", () => {
    const rules = BELL_MONASTERY_WORLD.globalRules;
    expect(rules).not.toContain("种族语言与发声");
    expect(rules).not.toContain("动物只能与同族");
    expect(rules).not.toContain("鼠王对非同族");

    const dog = BELL_MONASTERY_WORLD.actors.find((actor) => actor.name === "小狗“煤渣”");
    const pup = BELL_MONASTERY_WORLD.actors.find((actor) => actor.name === "小鼠“坏运气”");
    const king = BELL_MONASTERY_WORLD.actors.find((actor) => actor.name === "鼠王");
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

  it("passes content validation", () => {
    expect(() => parseWorldContent(BELL_MONASTERY_WORLD)).not.toThrow();
  });

  it("keeps names plain and makes actor / stage names globally unique", () => {
    const names = [
      BELL_MONASTERY_WORLD.worldName,
      ...BELL_MONASTERY_WORLD.stages.flatMap((stage) => [
        stage.name,
        ...(stage.anchors ?? []).flatMap((anchor) => (anchor.items ?? []).map((item) => item.name)),
      ]),
      ...BELL_MONASTERY_WORLD.actors.flatMap((actor) => [
        actor.name,
        ...actor.items.map((item) => item.name),
      ]),
    ];
    for (const name of names) {
      expect(name).not.toMatch(/[@#\s.]/);
    }
    const actorAndStage = [
      ...BELL_MONASTERY_WORLD.stages.map((stage) => stage.name),
      ...BELL_MONASTERY_WORLD.actors.map((actor) => actor.name),
    ];
    expect(new Set(actorAndStage).size).toBe(actorAndStage.length);
  });

  it("declares starting signature names with actor keys, not display names", () => {
    const keys = new Set(BELL_MONASTERY_WORLD.actors.map((actor) => actor.key));
    const edges = BELL_MONASTERY_WORLD.signatureNames ?? [];
    expect(edges).toHaveLength(5);
    for (const edge of edges) {
      expect(keys.has(edge.observer)).toBe(true);
      expect(keys.has(edge.subject)).toBe(true);
      expect(edge.observer).not.toBe(edge.subject);
      // 内容层不允许用展示名当引用。
      expect(edge.observer).not.toContain(".");
      expect(edge.subject).not.toContain(".");
    }
  });

  it("lets the rat king remember the crypt it came out of", () => {
    // 只有鼠王去过钟窖：到访是记忆，不是通行证。
    expect(BELL_MONASTERY_WORLD.visitedStages).toEqual([
      { actor: "rat-king", stage: "bell-crypt" },
    ]);
    const king = BELL_MONASTERY_WORLD.actors.find((actor) => actor.name === "鼠王");
    expect(king?.openingBriefing).toContain("记得后墙的祭坛后面还有一处地方");
    expect(king?.openingBriefing).toContain("现在那道门封着");
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

  it("connects the graveyard, coffin, cellar, bell crypt, crematorium, gate and mountain path", () => {
    const edges = new Set(
      BELL_MONASTERY_WORLD.connections.map((connection) => `${connection.from}->${connection.to}`),
    );
    expect([...edges].sort()).toEqual(
      [
        "coffin->graveyard",
        "graveyard->cellar",
        "cellar->graveyard",
        "cellar->bell-crypt",
        "bell-crypt->cellar",
        "graveyard->crematorium",
        "crematorium->graveyard",
        "graveyard->gate",
        "gate->graveyard",
        "gate->mountain-path",
      ].sort(),
    );
  });

  it("keeps the bell crypt sealed behind the cellar's altar", () => {
    const entrance = BELL_MONASTERY_WORLD.connections.find(
      (connection) => connection.from === "cellar" && connection.to === "bell-crypt",
    );
    expect(entrance?.passage).toBe("sealed");
    // 只能出、不能从别处进：回到修道院仍要走地窖。
    expect(
      BELL_MONASTERY_WORLD.connections
        .filter((connection) => connection.to === "bell-crypt")
        .map((connection) => connection.from),
    ).toEqual(["cellar"]);
    expect(
      BELL_MONASTERY_WORLD.connections.some(
        (connection) => connection.from === "bell-crypt" && connection.to === "cellar",
      ),
    ).toBe(true);
    // 发现与触发都写在地窖的 GM 文本里：祭坛、钟舌、后墙；可观察文本不先把钟窖说出来。
    expect(stage("cellar").profile).toContain("钟形纹");
    expect(stage("cellar").profile).toContain("钟舌");
    expect(stage("cellar").environment).not.toContain("钟窖");
    // 密室的存在不靠环境文本铺垫：地窖只看得见一座空着凹槽的祭坛。
    expect(stage("cellar").environment).toContain("凹槽空着");
    expect(stage("bell-crypt").environment).toContain("钟形花纹");
    expect(stage("bell-crypt").environment).toContain("尸骸");
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
