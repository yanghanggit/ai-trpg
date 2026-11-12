import { formatForm } from "../src/game/agents/appearance/form";
import type { WorldFunction } from "../src/game/kernel/types";
import type { World } from "../src/game/world-definition";

/**
 * 测试专用的小型世界；不随演示剧情变化。
 *
 * 能力清单和种子一样逐角色显式写出，便于断言“谁能做什么”。
 */
const TEST_CAMPAIGN_SETTING = "这是一个用于验证服务层行为的封闭测试世界。";
const TEST_GLOBAL_RULES = "角色只能沿舞台连接移动；行动结果由服务层结算。";

const TEST_WORLD_FUNCTIONS: Record<WorldFunction, string> = {
  affixes: "词缀后果用灰烬、旧蜡与铜锈的语汇。",
  story: "用克制的第三人称过去时讲述。",
  compact: "压缩时保住灰烬门廊与断钟中殿的原样。",
  dialogueAudit: "这个测试世界允许克制的暴力；现代器物按出界处理。",
};

/** 测试世界的职能宪法：与生产同构（身份 → 职责 → 设定 → 规则 → 口径），文本留给测试。 */
function renderTestFunctionPrompts(): Record<WorldFunction, string> {
  const prompts = {} as Record<WorldFunction, string>;
  for (const [fn, profile] of Object.entries(TEST_WORLD_FUNCTIONS) as [WorldFunction, string][]) {
    prompts[fn] = `# ${fn}

你是这个世界的一项职能：${fn}。

## 职责

测试职能。

## 战役设定

${TEST_CAMPAIGN_SETTING}

## 全局规则

${TEST_GLOBAL_RULES}

## 本职能

${profile}`;
  }
  return prompts;
}

export const TEST_WORLD: World = {
  contentVersion: "test-world.v1",
  contentKey: "test-world",
  worldName: "灰烬测试局",
  profile: "一个封闭的测试世界：故事在门廊与中殿之间收束，没有别的出口。",
  campaignSetting: TEST_CAMPAIGN_SETTING,
  globalRules: TEST_GLOBAL_RULES,
  functionPrompts: renderTestFunctionPrompts(),
  stages: [
    {
      key: "gate",
      name: "灰烬门廊",
      profile: "修道院的入口，穹顶塌了一半，长明灯只剩冷灰。",
      actions: [
        "submit_environment",
        "notify_world",
        "add_anchor",
        "remove_anchor",
        "update_anchor",
      ],
      environment: "风从破窗灌入，灰烬像雪一样落在石阶上。",
      anchors: [{ key: "latch", label: "门闩", description: "门板上被灰烬塞住的门闩。" }],
    },
    {
      key: "nave",
      name: "断钟中殿",
      profile: "修道院的中殿，巨大的铜钟坠落在裂纹纵横的地面上。",
      actions: [
        "submit_environment",
        "notify_world",
        "add_anchor",
        "remove_anchor",
        "update_anchor",
      ],
      environment: "烛泪凝成黑色硬壳，空气里混着铁锈与旧蜡的味道。",
    },
  ],
  connections: [
    { from: "gate", to: "nave" },
    { from: "nave", to: "gate" },
  ],
  // 测试世界里三个人一开始就同处门廊并互相认识；名字门槛由专门用例覆盖。
  signatureNames: [
    { observer: "ember-keeper", subject: "lantern-monk", name: "提灯修士" },
    { observer: "ember-keeper", subject: "silent-scribe", name: "缄默抄经人" },
    { observer: "lantern-monk", subject: "ember-keeper", name: "守烬人" },
    { observer: "lantern-monk", subject: "silent-scribe", name: "缄默抄经人" },
    { observer: "silent-scribe", subject: "ember-keeper", name: "守烬人" },
    { observer: "silent-scribe", subject: "lantern-monk", name: "提灯修士" },
  ],
  actors: [
    {
      stageKey: "gate",
      key: "ember-keeper",
      name: "守烬人",
      profile: "一个把自己裹在旧羊毛斗篷里的拾荒者。",
      signature: {
        form: formatForm("人类", "瘦高，手背有旧烧伤，脸上覆着一层洗不净的灰。"),
        appearance: "斗篷边缘被烧焦，脸上覆着一层洗不净的灰。",
      },
      hp: 12,
      // 攻击力全部来自源属性：力量 6 = 旧的 strength 0 + damage 6，数值断言不变；
      // 力量如何进入挥击/横扫由专门的用例覆盖。敏捷按 4，用于察觉与窃取的比较。
      // 防御只能来自装备：旧的角色 block 2 落在那件斗篷上。
      stats: { maxHp: 12, strength: 6, wisdom: 2, agility: 4, damage: 0, block: 0 },
      equipment: { weapon: "裂齿短刃", armor: "旧羊毛斗篷" },
      // 测试世界里的玩家角色额外拥有 loot 与「探囊」，用于验证取物的三条通道。
      proficiencies: [
        {
          key: "pickpocket",
          name: "探囊",
          description: "先看清，再取走：这两个动作在测试世界里成对出现。",
          actions: ["inspect", "steal"],
        },
      ],
      actions: [
        "say",
        "whisper",
        "announce",
        "move",
        "wait",
        "brawl",
        "give",
        "pickup",
        "loot",
        "equip",
        "unequip",
      ],
      inventory: [
        {
          key: "cracked-blade",
          name: "裂齿短刃",
          description: "刃口崩了三处，握柄缠着发黑的布条。",
          kind: "weapon" as const,
          count: 1,
          stats: { damage: 3, block: 0 },
          // 裂齿短刃提供 strike：装备中才把挥击借给角色；use 不看槽位，穿着也能用。
          actions: ["strike"],
          affixes: {
            strike: [
              {
                name: "裂齿",
                content: "崩口撕开皮肉，造成 {{attack}} 点伤害",
                ops: [{ kind: "damage", amount: { ref: "attack" } }],
              },
            ],
            use: [
              {
                name: "短刃刺击",
                content: "刃尖捅进去，造成 {{attack}} 点伤害",
                ops: [{ kind: "damage", amount: { ref: "attack" } }],
              },
            ],
          },
        },
        {
          key: "burnt-wool-cloak",
          name: "旧羊毛斗篷",
          description: "边角被烧焦，灰渍渗进纤维，披上能挡一点钝击。",
          kind: "equipment" as const,
          count: 1,
          stats: { block: 2 },
        },
      ],
    },
    {
      stageKey: "gate",
      key: "lantern-monk",
      name: "提灯修士",
      profile: "一个不肯摘下兜帽的修士。",
      signature: {
        form: formatForm("人类", "中等身量，右手虎口有一圈烫疤，指节被灯烟熏黄。"),
        appearance: "灰袍下摆浸着泥水，右手始终握着灯柄。",
      },
      hp: 10,
      // 力量 10 = 旧的 strength 5 + damage 5；防御全在穿戴的提灯上。
      stats: { maxHp: 10, strength: 10, wisdom: 3, agility: 3, damage: 0, block: 0 },
      equipment: { armor: "铅封提灯" },
      actions: [
        "say",
        "whisper",
        "announce",
        "move",
        "wait",
        "brawl",
        "give",
        "pickup",
        "equip",
        "unequip",
      ],
      inventory: [
        {
          key: "lead-lantern",
          name: "铅封提灯",
          description: "灯罩外缠着三道铅封。",
          kind: "equipment" as const,
          count: 1,
          stats: { block: 3 },
        },
      ],
    },
    {
      stageKey: "nave",
      key: "silent-scribe",
      name: "缄默抄经人",
      profile: "一个在断钟旁抄写无字经文的老人。",
      signature: {
        form: formatForm("人类", "枯瘦，指节沾满黑蜡，右膝因常年跪坐而变形。"),
        appearance: "指节沾满黑蜡，膝上摊着一卷空白经页。",
      },
      hp: 9,
      // 力量 8 = 旧的 strength 4 + damage 4；防御来自穿戴的经页。
      stats: { maxHp: 9, strength: 8, wisdom: 4, agility: 2, damage: 0, block: 0 },
      equipment: { armor: "无字经页" },
      actions: [
        "say",
        "whisper",
        "announce",
        "move",
        "wait",
        "brawl",
        "give",
        "pickup",
        "equip",
        "unequip",
      ],
      inventory: [
        {
          key: "blank-scripture",
          name: "无字经页",
          description: "纸面空白，边缘却密密写着被擦去的指印。",
          kind: "equipment" as const,
          count: 1,
          stats: { block: 4 },
        },
      ],
    },
  ],
  actions: ["notify_stage", "end_game"],
};
