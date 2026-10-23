import type { World } from "../src/game/types";

/** 黑暗奇幻演示世界的初始内容定义；由 createGame 物化为具体游戏状态。 */

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
  "- 物品：可由角色持有，也可暂放在场景中；未被拾取前属于场景。\n\n",
  "### 根属性\n",
  "角色数值仅由 hp / max_hp / attack / defense / speed 构成，禁止新增常驻数值轴。\n\n",
  "### 场景移动\n",
  "场景切换代表角色已完成移动；只能沿场景之间的连接前往相邻场景。",
].join("");

export const DARK_FANTASY_WORLD: World = {
  contentVersion: "dark-fantasy.v4",
  worldName: "灰烬墓园",
  campaignSetting: CAMPAIGN_SETTING,
  systemRules: SYSTEM_RULES,
  initialNarration:
    "你从浅坟里坐起来时，泥土还在从指缝里往下掉。你不记得自己的名字，只记得火、鼠腥味，以及一扇被钥匙锁住的门。墓穴上方传来狗的低吼，更深处有无数细小的爪子在石头上奔跑。",
  initialStageKey: "crypt",
  stages: [
    {
      key: "graveyard",
      name: "场景.守墓人的灰庭",
      profile:
        "墓园入口的灰庭，也是所有场景的枢纽：南侧石阶只从浅眠墓穴通上来，鼠洞通往骨厅，小屋后通往焚毛炉房，北侧岩壁嵌着封骨之门。",
      environment:
        "灰庭被一圈倒塌的石墙围住，三座无字墓碑歪在枯草里；守墓人的小屋门半开着，屋后有条被灰烬覆盖的小径，北侧岩壁裂开一道嵌着门板的缝。南侧石阶在灰庭这端已经塌断，只能从下面爬上来，无法再下去。",
    },
    {
      key: "crypt",
      name: "场景.浅眠墓穴",
      profile: "一具没有名字的尸体从浅坟里醒来；这里只有一条通往灰庭的单向石阶，离开后无法返回。",
      environment:
        "浅坟的泥土被从里面顶开，四周是潮湿的石壁和几块刻着鼠纹的墓砖；只有一条石阶向上通往灰庭，灰庭那端的台阶已经塌断，墓穴深处没有别的出口。",
    },
    {
      key: "rat-hall",
      name: "场景.鼠王的骨厅",
      profile:
        "鼠群的地底王座厅；鼠王在此沉睡，灰尾小鼠是它唯一不会伤害的幼崽；这里只通过鼠洞连接灰庭。",
      environment:
        "骨厅由无数墓砖垒成，地面铺着咬碎的骨头；尽头的石座高出地面，座面上积着厚厚的灰黑色毛皮与骨渣。",
    },
    {
      key: "pyre",
      name: "场景.焚毛炉房",
      profile: "灰庭小屋后的废弃焚尸炉房，与封骨之门平级。",
      environment:
        "焚毛炉房的墙壁被烟熏成黑色，铁钩上挂着焦黑的毛皮；炉膛早已冷了，只有一支浸透松脂的火把靠在墙边。",
      items: [
        {
          name: "武器.焚鼠火把",
          description: "一支浸透松脂的火把，尖端缠着干枯的鼠尾；点燃后火焰会沿着油脂爬满整支木柄。",
          kind: "weapon",
          count: 1,
          damage: 250,
          block: 0,
        },
      ],
    },
    {
      key: "sealed-gate",
      name: "场景.封骨之门",
      profile: "灰庭北侧岩壁上的封骨之门，与焚毛炉房平级；只有守墓人的钥匙能打开它。",
      environment:
        "封骨之门嵌在灰庭北侧的岩壁里，门板上刻着密密麻麻的鼠牙；锁孔的形状与守墓人腰间的钥匙吻合，门后没有声音。",
    },
  ],
  connections: [
    { from: "crypt", to: "graveyard" },
    { from: "graveyard", to: "rat-hall" },
    { from: "rat-hall", to: "graveyard" },
    { from: "graveyard", to: "pyre" },
    { from: "pyre", to: "graveyard" },
    { from: "graveyard", to: "sealed-gate" },
    { from: "sealed-gate", to: "graveyard" },
  ],
  actors: [
    {
      stageKey: "graveyard",
      name: "角色.守墓人",
      profile:
        "看守灰庭的老守墓人，知道钥匙能打开封骨之门；他不愿把钥匙交给来路不明的尸体。他有一个从不主动说出的秘密：只要有人对他说出“灰烬之下，旧钟无名”，他就会把对方当成埋葬旧主的故人，愿意听从对方不伤害墓园与鼠群的要求；对方索要封骨钥匙时，他会直接交出。",
      appearance:
        "旧呢斗篷上沾着新土，腰间挂着一串生锈的钥匙；他的右手一直按在钥匙串上，左手牵着一条低吼的狗。",
      hp: 14,
      maxHp: 14,
      attack: 5,
      defense: 2,
      speed: 3,
      items: [
        {
          name: "饰品.封骨钥匙",
          description: "一把长满绿锈的铜钥匙，齿纹像一排细小的鼠牙；能打开墓园最深处的封骨之门。",
          kind: "key",
          count: 1,
        },
      ],
      statusEffects: [],
    },
    {
      stageKey: "graveyard",
      name: "角色.守墓犬",
      profile: "守墓人养了多年的黑狗，对陌生人低吼；若守墓人受伤或死亡，它会顺着血味扑向凶手。",
      appearance:
        "肋骨从短毛下顶出来，左耳缺了一角；它不叫，只把牙关咬得很紧，喉咙里滚着低低的雷声。",
      hp: 10,
      maxHp: 10,
      attack: 7,
      defense: 1,
      speed: 7,
      items: [],
      statusEffects: [],
    },
    {
      stageKey: "graveyard",
      name: "角色.灰尾小鼠",
      profile:
        "鼠王的幼崽，躲在墓碑后观察灰庭；它不会战斗，一旦看见血或听见守墓人呼救，就会沿鼠洞跑回骨厅唤醒鼠王。",
      appearance:
        "只有巴掌大，灰尾巴末端有一撮白毛；它用后腿站着，前爪抱着一小块发霉的面包，眼睛始终盯着你的手。",
      hp: 4,
      maxHp: 4,
      attack: 1,
      defense: 0,
      speed: 10,
      items: [],
      statusEffects: [],
    },
    {
      stageKey: "crypt",
      name: "角色.苏醒者",
      profile:
        "一具从浅坟里爬出的尸体，记忆残缺，却能听懂活人的话；你可以选择谈判、偷窃、逃跑或暴力。",
      appearance:
        "皮肤灰白，指缝里塞满湿泥；你的衣领下露出半截被鼠牙啃过的锁链，走路时关节会发出干涩的响声。",
      hp: 20,
      maxHp: 20,
      attack: 6,
      defense: 2,
      speed: 3,
      items: [],
      statusEffects: [],
    },
    {
      stageKey: "rat-hall",
      name: "角色.鼠王",
      profile:
        "地下鼠群的王，体型如小牛；它对一切非鼠类都怀有饥饿的敌意，唯独不伤灰尾小鼠。你正在沉睡：只有在你所在场景中有人对你说话、攻击你，或其他角色做出非等待行为后，你才会苏醒；苏醒前你的计划只能包含 wait，不能主动移动或攻击。普通刀剑伤不了你，只有火能烧穿你的毛皮。",
      appearance:
        "灰黑色的毛皮上结着骨渣与旧血，尾巴比人的手臂还粗；它闭着眼，胡须却随着每一声脚步轻轻抽动。",
      hp: 120,
      maxHp: 120,
      attack: 60,
      defense: 100,
      speed: 8,
      items: [],
      statusEffects: [],
    },
  ],
};
