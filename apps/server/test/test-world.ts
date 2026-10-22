import { USE_ITEM_SKILL } from "../src/game/skills";
import type { World } from "../src/game/types";

/** 测试专用的小型世界；不随演示剧情变化。 */
export const TEST_WORLD: World = {
  contentVersion: "test-world.v1",
  worldName: "灰烬测试局",
  campaignSetting: "这是一个用于验证服务层行为的封闭测试世界。",
  systemRules: "角色只能沿场景连接移动；行动结果由服务层结算。",
  initialNarration: "钟声早已停了。你在灰烬门廊里醒来。",
  stages: [
    {
      key: "gate",
      name: "灰烬门廊",
      profile: "修道院的入口，穹顶塌了一半，长明灯只剩冷灰。",
      environment: "风从破窗灌入，灰烬像雪一样落在石阶上。",
      narrative: "门廊尽头是一道向内倾斜的拱门。",
    },
    {
      key: "nave",
      name: "断钟中殿",
      profile: "修道院的中殿，巨大的铜钟坠落在裂纹纵横的地面上。",
      environment: "烛泪凝成黑色硬壳，空气里混着铁锈与旧蜡的味道。",
      narrative: "铜钟的裂口里卡着一截发黑的手指。",
    },
  ],
  connections: [
    { from: "gate", to: "nave" },
    { from: "nave", to: "gate" },
  ],
  actors: [
    {
      stageKey: "gate",
      name: "守烬人",
      profile: "一个把自己裹在旧羊毛斗篷里的拾荒者。",
      appearance: "斗篷边缘被烧焦，脸上覆着一层洗不净的灰。",
      hp: 12,
      maxHp: 12,
      attack: 6,
      defense: 2,
      speed: 4,
      items: [
        {
          name: "裂齿短刃",
          description: "刃口崩了三处，握柄缠着发黑的布条。",
          kind: "weapon",
          count: 1,
          damage: 3,
          block: 0,
        },
      ],
      skills: [USE_ITEM_SKILL],
      statusEffects: [],
    },
    {
      stageKey: "gate",
      name: "提灯修士",
      profile: "一个不肯摘下兜帽的修士。",
      appearance: "灰袍下摆浸着泥水，右手始终握着灯柄。",
      hp: 10,
      maxHp: 10,
      attack: 5,
      defense: 3,
      speed: 3,
      items: [
        {
          name: "铅封提灯",
          description: "灯罩外缠着三道铅封。",
          kind: "relic",
          count: 1,
        },
      ],
      skills: [USE_ITEM_SKILL],
      statusEffects: [],
    },
    {
      stageKey: "nave",
      name: "缄默抄经人",
      profile: "一个在断钟旁抄写无字经文的老人。",
      appearance: "指节沾满黑蜡，膝上摊着一卷空白经页。",
      hp: 9,
      maxHp: 9,
      attack: 4,
      defense: 4,
      speed: 2,
      items: [
        {
          name: "无字经页",
          description: "纸面空白，边缘却密密写着被擦去的指印。",
          kind: "relic",
          count: 1,
        },
      ],
      skills: [USE_ITEM_SKILL],
      statusEffects: [],
    },
  ],
};
