import type { World } from "../src/game/types";

/**
 * 测试专用的小型世界；不随演示剧情变化。
 *
 * 能力清单和种子一样逐角色显式写出，便于断言“谁能做什么”。
 */
export const TEST_WORLD: World = {
  contentVersion: "test-world.v1",
  contentKey: "test-world",
  worldName: "灰烬测试局",
  profile: "一个封闭的测试世界：故事在门廊与中殿之间收束，没有别的出口。",
  campaignSetting: "这是一个用于验证服务层行为的封闭测试世界。",
  systemRules: "角色只能沿场景连接移动；行动结果由服务层结算。",
  stages: [
    {
      key: "gate",
      name: "灰烬门廊",
      profile: "修道院的入口，穹顶塌了一半，长明灯只剩冷灰。",
      actions: ["submit_environment", "notify_world"],
      environment: "风从破窗灌入，灰烬像雪一样落在石阶上。",
    },
    {
      key: "nave",
      name: "断钟中殿",
      profile: "修道院的中殿，巨大的铜钟坠落在裂纹纵横的地面上。",
      actions: ["submit_environment", "notify_world"],
      environment: "烛泪凝成黑色硬壳，空气里混着铁锈与旧蜡的味道。",
    },
  ],
  connections: [
    { from: "gate", to: "nave" },
    { from: "nave", to: "gate" },
  ],
  // 测试世界里三个人一开始就同处门廊并互相认识；名字门槛由专门用例覆盖。
  knownIdentities: [
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
      appearance: "斗篷边缘被烧焦，脸上覆着一层洗不净的灰。",
      baseBody: { race: "人类", description: "瘦高，手背有旧烧伤，脸上覆着一层洗不净的灰。" },
      hp: 12,
      stats: { maxHp: 12, strength: 6, wisdom: 2, agility: 4, damage: 6, block: 2 },
      equipment: { weapon: "裂齿短刃" },
      // 测试世界里的玩家角色额外拥有 steal，用于验证私密事件。
      actions: [
        "say",
        "whisper",
        "announce",
        "move",
        "wait",
        "brawl",
        "give",
        "pickup",
        "use",
        "steal",
        "equip",
        "unequip",
      ],
      items: [
        {
          key: "cracked-blade",
          name: "裂齿短刃",
          description: "刃口崩了三处，握柄缠着发黑的布条。",
          kind: "weapon" as const,
          count: 1,
          stats: { damage: 3, block: 0 },
          effect: { type: "damage" },
          // 裂齿短刃提供 strike：装备中才把挥击借给角色。
          actions: ["strike"],
        },
      ],
    },
    {
      stageKey: "gate",
      key: "lantern-monk",
      name: "提灯修士",
      profile: "一个不肯摘下兜帽的修士。",
      appearance: "灰袍下摆浸着泥水，右手始终握着灯柄。",
      baseBody: { race: "人类", description: "中等身量，右手虎口有一圈烫疤，指节被灯烟熏黄。" },
      hp: 10,
      stats: { maxHp: 10, strength: 5, wisdom: 3, agility: 3, damage: 5, block: 3 },
      actions: [
        "say",
        "whisper",
        "announce",
        "move",
        "wait",
        "brawl",
        "give",
        "pickup",
        "use",
        "equip",
        "unequip",
      ],
      items: [
        {
          key: "lead-lantern",
          name: "铅封提灯",
          description: "灯罩外缠着三道铅封。",
          kind: "equipment" as const,
          count: 1,
          stats: { block: 2 },
          effect: { type: "event" },
        },
      ],
    },
    {
      stageKey: "nave",
      key: "silent-scribe",
      name: "缄默抄经人",
      profile: "一个在断钟旁抄写无字经文的老人。",
      appearance: "指节沾满黑蜡，膝上摊着一卷空白经页。",
      baseBody: { race: "人类", description: "枯瘦，指节沾满黑蜡，右膝因常年跪坐而变形。" },
      hp: 9,
      stats: { maxHp: 9, strength: 4, wisdom: 4, agility: 2, damage: 4, block: 4 },
      actions: [
        "say",
        "whisper",
        "announce",
        "move",
        "wait",
        "brawl",
        "give",
        "pickup",
        "use",
        "equip",
        "unequip",
      ],
      items: [
        {
          key: "blank-scripture",
          name: "无字经页",
          description: "纸面空白，边缘却密密写着被擦去的指印。",
          kind: "equipment" as const,
          count: 1,
          stats: { block: 2 },
          effect: { type: "event" },
        },
      ],
    },
  ],
  actions: ["notify_stage", "end_game"],
};
