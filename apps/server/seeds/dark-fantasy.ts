import type { WorldSeed } from "../src/game/types";

export const DEMO_USER = {
  id: "00000000-0000-4000-8000-000000000001",
  username: "demo",
  displayName: "灰烬行者",
} as const;

const CAMPAIGN_SETTING = [
  "这是一个架空的黑暗奇幻世界，魔法是常见而危险的力量，旧神、亡灵与饥荒共同塑造了大地。",
  "诸文明与时代在此层叠并存，现实中的文化、神话、历史与习俗都是母题，被转译、改写为本世界独有的国家、族群、信仰与传奇，不得照搬现实专名。",
  "此世没有安全的恩典，恐怖、血腥与暴力是日常的一部分；一切创作与扮演都须遵循本世界自身的逻辑，不引入世界之外的事物。",
].join("");

const SYSTEM_RULES = [
  "### 角色扮演契约\n",
  "你是在扮演一个特定实体，必须以该实体的身份、视角、知识与认知边界去感知、思考与言说。",
  "避免“根据游戏规则”等元语言，用行为与感官描写代替抽象陈述。\n\n",
  "### 游戏实体\n",
  "- 角色：可交互的生命体，始终处于某个场景。\n",
  "- 场景：角色活动的地点，角色不能脱离场景存在。\n",
  "- 物品：由角色持有的物件，不能脱离持有者存在。\n\n",
  "### 根属性\n",
  "角色数值仅由 hp / max_hp / attack / defense / speed 构成，禁止新增常驻数值轴。\n\n",
  "### 场景移动\n",
  "场景切换代表角色已完成移动；只能沿场景之间的连接前往相邻场景。",
].join("");

export const DARK_FANTASY_SEED: WorldSeed = {
  contentVersion: "dark-fantasy.v1",
  worldName: "灰烬钟声",
  campaignSetting: CAMPAIGN_SETTING,
  systemRules: SYSTEM_RULES,
  initialNarration:
    "钟声早已停了。你在一座被灰烬掩埋的门廊里醒来，铁锈味从石缝里渗出来，远处有东西在暗处拖动锁链。",
  stages: [
    {
      key: "gate",
      name: "灰烬门廊",
      profile: "修道院的入口，穹顶塌了一半，长明灯只剩冷灰。",
      environment: "风从破窗灌入，灰烬像雪一样落在石阶上；门外是没有尽头的黑松林。",
      narrative: "门廊尽头是一道向内倾斜的拱门，门后传来断断续续的钟绳摩擦声。",
    },
    {
      key: "nave",
      name: "断钟中殿",
      profile: "修道院的中殿，巨大的铜钟坠落在裂纹纵横的地面上。",
      environment: "烛泪凝成黑色硬壳，空气里混着铁锈、旧蜡与潮湿石尘的味道。",
      narrative: "铜钟的裂口里卡着一截发黑的手指，钟腹深处似乎还有微弱的回声。",
    },
  ],
  connections: [{ from: "gate", to: "nave" }],
  actor: {
    stageKey: "gate",
    name: "守烬人",
    profile: "一个把自己裹在旧羊毛斗篷里的拾荒者，记得如何辨认灰烬中的脚印，也记得不要回应钟声。",
    appearance: "斗篷边缘被烧焦，左手戴着三枚不同尺寸的铜戒，脸上覆着一层洗不净的灰。",
    hp: 12,
    maxHp: 12,
    attack: 3,
    defense: 2,
    speed: 4,
  },
  item: {
    name: "裂齿短刃",
    description: "刃口崩了三处，握柄缠着发黑的布条；靠近时能闻到极淡的盐味。",
    kind: "weapon",
  },
};
