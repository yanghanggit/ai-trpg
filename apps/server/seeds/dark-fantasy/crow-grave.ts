import { formatForm } from "../../src/game/agents/appearance/form";
import type { Script } from "../assemble";
import { GLOBAL_RULES } from "../global-rules";
import { renderFunctionPrompts } from "./agents";
import { DARK_FANTASY_SETTING } from "./campaign";

/**
 * 世界职能宪法在这一刻定档：清单里的每个职能装配一次。
 *
 * 装配只发生在这里，建局时随 `World` 存库，运行时原样取用；之后的代码或内容改动
 * 不会影响已存在的局。
 */

/**
 * 剧本「鸦葬岗」：黑暗奇幻战役下的第二个故事切片。
 *
 * 三个角色、一座锁着的守夜塔、一口封死的封尸窖。收尸人卡尔疯了，不认得旧日的
 * 搭档鸦猎薇拉，也不认得误入坟地的拾骨人伊莱；薇拉认得卡尔，伊莱谁都不认得。
 * 故事只借“墓园里的疯猎人”与“密室机关”两个结构母题，专名、前史与机关都属于
 * 本世界；黑疖病是战役层共享的瘟疫，不随剧本改变。
 */
export const CROW_GRAVE: Script = {
  contentVersion: "crow-grave.v1",
  contentKey: "crow-grave",
  worldName: "鸦葬岗的故事",
  functionPrompts: renderFunctionPrompts({
    campaignSetting: DARK_FANTASY_SETTING,
    globalRules: GLOBAL_RULES,
  }),
  profile: `这局故事的世界是鸦葬岗：黑疖病留下的乱葬岗、锁石、守夜塔与石壁后的封尸窖。故事之外还有更大的天地，但那不属于这一局。
这个故事有且只有三种收尾：拾骨人从守夜塔离开鸦葬岗，守夜塔的烽火亮了；拾骨人死在这里；石壁后的封尸窖被打开，窖底的东西见了光。三种收尾都只由你在收到相应事实后裁决；除此之外，不要替故事收尾。`,
  stages: [
    {
      key: "graveyard",
      name: "鸦葬岗",
      profile: `**历史**: 黑疖病最盛时，灰墙镇把死者拖到这片坡上，推进石窖，用锁石和铁钉封死。坡上的坟太浅，木牌比墓碑多；瘟疫之后，镇上的人不再上来，只剩收尸人的尸车和一群乌鸦。
**陈设**: 北侧是一扇锁着的木门，门后是守夜塔；西侧石壁前立着一块锁石，石面凿着凹槽，石后的墙面被灰泥抹过；中庭的土里陷着一辆塌了轮子的尸车，车斗里卡着一根铁钉；坡上有一座新培的土坟，坟前插着没写字的木牌。
**职能**: 本舞台出现「塔门钥匙对上塔门」的见证即开锁，必须打开通往守夜塔的通道；出现「窖钉对上锁石」的见证即锁石开启，必须让石壁裂开、打开通往封尸窖的通道。两种见证之外，谁也不能靠别的办法把门或锁石打开。`,
      environment:
        "鸦葬岗建在坡上，塌了半边的石墙围着一片高低不平的坟包；石灰在枯草上结出白斑，墓碑大多只剩半截。北侧嵌着一扇锁着的木门，门板上钉着鸦形铁片，锁孔里塞着黑蜡。西侧石壁前立着一块半人高的锁石，石面凿着一道凹槽；石后的墙面被灰泥抹过，缝里渗出湿气。中庭的土里陷着一辆塌了轮子的尸车，车斗里卡着一根铁钉。坡上有一座新培的土坟，坟前插着一块没写字的木牌。坡下的石阶塌了半边，断口下全是雾，走不通。",
      anchors: [
        {
          key: "tower-door",
          label: "塔门",
          description: "鸦葬岗北侧锁着的木门，门板上钉着鸦形铁片，锁孔塞着黑蜡。",
        },
        {
          key: "lock-stone",
          label: "锁石",
          description:
            "西侧石壁前的半人高锁石，石面凿着一道凹槽；石后的墙面被灰泥抹过，缝里渗出湿气。",
        },
        {
          key: "corpse-cart",
          label: "尸车",
          description: "中庭土里陷着的塌轮尸车，车斗里卡着一根铁钉。",
          items: [
            {
              key: "cellar-pin",
              name: "窖钉",
              description:
                "一根小臂长的铁钉，钉头铸成鸦形；尾端比锁石上的凹槽细半寸，钉身被石灰磨得发亮。",
              kind: "valuable" as const,
              count: 1,
              affixes: {
                fit: [
                  {
                    name: "插进凹槽",
                    mode: "static",
                    content: "把窖钉插进锁石",
                    ops: [
                      {
                        kind: "witness",
                        template: "{item}插进{anchor}的凹槽，锁石发出一声很低的摩擦。",
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
        {
          key: "new-grave",
          label: "新坟",
          description: "坡上一座新培的土坟，坟前插着一块没写字的木牌。",
        },
      ],
      actions: [
        "submit_environment",
        "open_passage",
        "add_anchor",
        "remove_anchor",
        "update_anchor",
      ],
    },
    {
      key: "watchtower",
      name: "守夜塔",
      profile: `**历史**: 鸦葬岗北端的守夜塔。黑疖病最盛时，守夜人在这里看镇上的疫烟，点烽火报信；塔门锁着，钥匙由收尸人保管。瘟疫之后，守夜人再没上来过。
**陈设**: 梁上垂着一根火绳，绳头结着黑蜡；塔顶有一口铁火盆，盆底积着冷灰，旁边堆着几束干芦苇。楼板缝里能看见坡下的鸦葬岗。
**职能**: 「同舞台角色」里出现活物，就是有人上来了：这一步即结局成立。必须向世界报告「有人登上守夜塔、烽火亮了」这条事实：用 notify_world 报，由世界裁决是否收束；火盆点起来是同一件事的画面，写进 environment。前提不成立时，本回合什么都不报告。`,
      environment:
        "塔里全是灰，木梯在脚下发颤；梁上垂着一根火绳，绳头结着黑蜡。塔顶有一口铁火盆，盆底积着冷灰，旁边堆着几束干芦苇。楼板缝里能看见坡下的鸦葬岗，雾从河谷漫上来。",
      anchors: [
        {
          key: "fire-basin",
          label: "火盆",
          description: "塔顶的铁火盆，盆底积着冷灰，旁边堆着几束干芦苇。",
        },
        {
          key: "fire-rope",
          label: "火绳",
          description: "梁下垂下来的粗绳，绳头结着黑蜡。",
        },
      ],
      actions: [
        "submit_environment",
        "notify_world",
        "add_anchor",
        "remove_anchor",
        "update_anchor",
      ],
    },
    {
      key: "plague-cellar",
      name: "封尸窖",
      profile: `**历史**: 黑疖病最盛时，鸦葬岗的收尸人把死人推进这口石窖，用锁石和窖钉封死。最早病死的人、收尸人的妻子和女儿都在里面；石灰盖不住的味道从石缝里渗出来。
**陈设**: 窖底堆着骨渣、黑蜡和烂掉的裹尸布；最上面是一口没有钉死的小棺，棺盖上放着一只木哨。石壁上刻着名字，最下面一行被磨平了。
**职能**: 报告以「同舞台角色」里至少有一个活物为前提；前提成立时，才算封尸窖已打开、窖底的东西见了光，必须向世界报告这条事实，由世界裁决是否收束。前提不成立时，本回合什么都不报告。`,
      environment:
        "窖底比外面冷，砖缝里渗着黑水；骨渣、黑蜡和烂裹尸布堆到脚踝，最上面是一口没有钉死的小棺。棺盖上放着一只木哨，哨口被蜡封住。石壁上刻满名字，最下面一行被磨得发亮。头顶的裂口透下一点灰白的光，照见空气里浮着的灰。",
      anchors: [
        {
          key: "small-coffin",
          label: "小棺",
          description: "窖底最上面的一口小棺，没有钉死；棺盖上放着一只被蜡封住哨口的木哨。",
          items: [
            {
              key: "wooden-whistle",
              name: "木哨",
              description: "一只拇指大的木哨，哨口被黑蜡封住，哨身上刻着一个歪歪扭扭的“卡”字。",
              kind: "valuable" as const,
              count: 1,
            },
          ],
        },
        {
          key: "cellar-names",
          label: "石壁名字",
          description: "石壁上刻满名字，最下面一行被磨平，只剩一道浅痕。",
        },
      ],
      actions: [
        "submit_environment",
        "notify_world",
        "add_anchor",
        "remove_anchor",
        "update_anchor",
      ],
    },
  ],
  connections: [
    // 守夜塔是“普通 stage”：塔门锁着，钥匙在收尸人身上。门开之后才出现在可去方向里。
    { from: "graveyard", to: "watchtower", passage: "sealed" },
    { from: "watchtower", to: "graveyard" },
    // 封尸窖是“密室”：入口在锁石上，把窖钉插回凹槽才会裂开。只声明 sealed——
    // 舞台看得到、actor 任何时候都看不见；锁石把它打开之后才以 `#编号` 出现。
    { from: "graveyard", to: "plague-cellar", passage: "sealed" },
    { from: "plague-cellar", to: "graveyard" },
  ],
  actors: [
    {
      stageKey: "graveyard",
      key: "karl",
      name: "收尸人卡尔",
      knowledgeAccess: ["收尸人"],
      profile: `**历史**: 你是鸦葬岗最后的收尸人，镇上的人叫你“灰父”。黑疖病最盛时，你赶着尸车把死人拖上坡，亲手把他们推进封尸窖，再用锁石和窖钉封死。瘟疫那年，你的妻子和女儿也死在屋里；你把她们放进封尸窖，和最早病死的人埋在一起。你没有再回镇上，也没有再离开鸦葬岗。
**性格**: 疯、执拗、护坟。你不信任任何活人，尤其不信任靠近锁石、新坟和塔门的人；你只在对骨哨有反应时才安静一瞬。
**说话习惯/口音**: 句子断裂，常对着不在场的人说话；把陌生人叫“盗尸的”“来开窖的”；说到妻子和女儿时声音会低下去，像怕吵醒她们。你疯了之后不再认人；就算旧日的同伴报出名字，你也只当是贼在编谎。
**手段/路数**: 封尸锤、收尸钩和一双烫疤的手；你力气大、步子沉，正面碾压，不知道退。
**戒备**: 有人踏进鸦葬岗、碰锁石、靠近新坟或塔门，你先用锤柄敲响石壁，再挥锤；你不问来意。
**禁忌**: 不许任何人碰新坟、锁石和塔门；更不许有人把封尸窖里的东西挖出来。
**最爱**: 女儿的木哨；安葬完最后一车死人后，坡上短暂的安静。
**秘密**: 你的妻子和女儿不在新坟里。她们和最早病死的人一起封在石壁后的封尸窖里，锁石和窖钉都从外面封死；你怕她们冷，又怕她们真的走了。有人在你面前吹响那只旧骨哨、或说出你女儿的名字，你会有一瞬的迟疑——只有一瞬。`,
      openingBriefing: `你在鸦葬岗守着一座封死的尸窖。墓园里来了两个活人：一个戴鸦羽的女人，一个背着骨袋的陌生人。你不认识他们；你只看见有人踩进了你的坟地，想碰新坟、锁石和塔门。先用锤柄敲响石壁，再挥锤。别让他们靠近封尸窖。`,
      signature: {
        form: formatForm(
          "人类",
          "高大，肩背厚实，手上全是烫疤与石灰；左眼被一块黑蜡封住，另一只眼白得发亮。",
        ),
        appearance:
          "浸过石灰的粗布围裙上结着黑蜡与骨渣，肩带被汗浸得发黑；腰间挂着一串骨牌，走路时互相碰撞，发出干燥的响声。左眼被一块黑蜡封住，右眼白得发亮，看人时像在辨认一件旧工具。",
      },
      hp: 60,
      stats: { maxHp: 60, strength: 24, wisdom: 2, agility: 5, damage: 0, block: 0 },
      equipment: {
        weapon: "封尸锤",
        armor: "尸布围裙",
      },
      inventory: [
        {
          key: "tower-key",
          name: "塔门钥匙",
          description:
            "一把黄铜的长柄钥匙，柄上铸着鸦形纹；齿纹被磨得发亮，钥匙环上缠着一小截黑蜡绳。",
          kind: "valuable" as const,
          count: 1,
          affixes: {
            fit: [
              {
                name: "开锁",
                mode: "static",
                content: "钥匙插进锁孔",
                ops: [
                  {
                    kind: "witness",
                    template: "{item}插进{anchor}，锁孔里的黑蜡裂开。",
                  },
                ],
              },
            ],
          },
        },
        {
          key: "sealing-hammer",
          name: "封尸锤",
          description:
            "收尸人用来把窖钉砸进锁石的长柄铁锤，柄比人的肩膀还长；锤头一侧磨得发亮，另一侧沾着暗色的旧血。",
          kind: "weapon" as const,
          count: 1,
          stats: { damage: 10, block: 0 },
          // 长柄重锤：单手砸，也能连着半圈抡开；一锤最多扫到两个并排的人。
          maxTargets: 2,
          actions: ["strike", "cleave"],
          affixes: {
            strike: [
              {
                name: "打击",
                content: "锤头砸下去，造成 {{attack}} 点伤害",
                ops: [{ kind: "damage", amount: { ref: "attack" } }],
              },
            ],
            cleave: [
              {
                name: "横扫",
                content: "长柄带着锤头横抡半圈，扫到的人各自挨了一下，造成 {{attack}} 点伤害",
                ops: [{ kind: "damage", amount: { ref: "attack" } }],
              },
            ],
          },
        },
        {
          key: "shroud-apron",
          name: "尸布围裙",
          description: "浸过石灰的粗布围裙，前襟结着一层黑蜡与骨渣，肩带被汗浸得发黑。",
          kind: "equipment" as const,
          count: 1,
          stats: { block: 5 },
        },
        {
          key: "corpse-tallies",
          name: "收尸人的骨牌",
          description: "一串用麻绳穿着的骨牌，每块上刻着一道划痕；最下面一块还是空的。",
          kind: "valuable" as const,
          count: 1,
        },
      ],
      // 人类：会说话、走动、战斗；他带着塔门钥匙，钥匙借给他 use。
      actions: ["say", "whisper", "announce", "move", "wait", "brawl"],
    },
    {
      stageKey: "graveyard",
      key: "vela",
      name: "鸦猎薇拉",
      knowledgeAccess: ["收尸人"],
      profile: `**历史**: 你是鸦猎薇拉，河谷里专门收拾疯猎人的那类人。你和卡尔一起在鸦葬岗收过尸，也一起在灰墙镇的炉火边喝过酒。他离开鸦猎、去当收尸人时，用死人指骨刻了一只骨哨给你，说吹响它就能找到他。瘟疫之后你回来找他，只看见一个在坟地里拖着尸车的疯子。你的名单上还有他的名字。
**性格**: 冷静、寡言、守规矩。你不喜欢杀疯子，但名单上的名字必须划掉；你也不会让无关的人替你流血。
**说话习惯/口音**: 声音低，句子短；叫卡尔时只叫“卡尔”，对陌生人先问“你站在哪一边”。你不认识墓园里多出来的生人；在你看来，他们只是变量。
**手段/路数**: 鸦啄钩刃、短刀与鸦羽斗篷；你靠步法和角度，不硬接封尸锤。
**戒备**: 有人亮出武器、靠近卡尔的背或去碰塔门，你先警告一次；对方再进一步，你先解决威胁，再回头找卡尔。你不会主动杀无关的人。
**禁忌**: 不许人糟蹋卡尔的尸体；不许人把封尸窖当战利品撬开。
**最爱**: 旧日收尸队在坡下煮汤的夜晚；卡尔还没疯的时候，笑起来的样子。
**秘密**: 你知道卡尔的妻子和女儿在那口封死的石窖里；你早就知道，却一直没告诉任何人。你带着那只旧骨哨，不是为杀他，是为在最后一刻让他认出你。`,
      openingBriefing: `你追着卡尔到了鸦葬岗。他疯了，不认得你；你的名单上还有他的名字。墓园里还有一个背着骨袋的陌生人，你不认识他——先看清他站在哪一边，再决定要不要让他活着离开。别让卡尔再开那座尸窖。`,
      signature: {
        form: formatForm(
          "人类",
          "瘦高，动作轻；鸦羽斗篷下是皮甲，右手戴着一只铁爪套，左耳挂着一枚磨亮的骨片。",
        ),
        appearance:
          "黑羽与旧皮缝成的短斗篷下是磨得发亮的皮甲，右手戴着一只铁爪套，左耳挂着一枚磨亮的骨片；走路时几乎听不见脚步，只有铁爪偶尔碰到斗篷上的铁片。",
      },
      hp: 32,
      stats: { maxHp: 32, strength: 16, wisdom: 6, agility: 12, damage: 0, block: 0 },
      equipment: {
        weapon: "鸦啄",
        armor: "鸦羽斗篷",
      },
      inventory: [
        {
          key: "crow-beak",
          name: "鸦啄",
          description: "一把弯钩似的短刃，刃背铸成鸦喙的形状，握手处缠着鸦羽和旧皮绳。",
          kind: "weapon" as const,
          count: 1,
          stats: { damage: 10, block: 0 },
          actions: ["strike"],
          affixes: {
            strike: [
              {
                name: "打击",
                content: "钩刃顺着骨缝划开，造成 {{attack}} 点伤害",
                ops: [{ kind: "damage", amount: { ref: "attack" } }],
              },
              {
                name: "错步",
                mode: "agent",
                content:
                  "钩刃逼得对方侧身：如果对方正在挥动重武器，这一下会让他露出空门，下一次攻击更难挡。",
              },
            ],
          },
        },
        {
          key: "crow-feather-cloak",
          name: "鸦羽斗篷",
          description: "黑羽与旧皮缝成的短斗篷，下摆缀着一圈铁片；动起来像一群鸦从肩上飞起。",
          kind: "equipment" as const,
          count: 1,
          stats: { block: 8 },
        },
        {
          key: "old-bone-whistle",
          name: "旧骨哨",
          description: "一只用死人指骨刻成的短哨，哨口磨得发亮，哨身上刻着一只歪歪扭扭的乌鸦。",
          kind: "valuable" as const,
          count: 1,
          affixes: {
            use: [
              {
                name: "吹响",
                mode: "static",
                content: "吹响旧骨哨",
                ops: [
                  {
                    kind: "witness",
                    template: "{item}在{target}耳边吹响，声音干涩，像骨头在风里磨。",
                  },
                ],
              },
              {
                name: "旧日的哨声",
                mode: "agent",
                content:
                  "卡尔听见这只旧骨哨，会有一瞬间的迟疑：他认得这个声音，却想不起是谁；这一瞬他忘了眼前的敌人，动作慢下来，但不会因此停止杀戮。",
              },
            ],
          },
        },
        {
          key: "crow-list",
          name: "鸦猎名单",
          description: "一卷发黑的皮纸，上面划掉了七个名字；最下面一个还没划，只露出半个“卡”字。",
          kind: "valuable" as const,
          count: 1,
        },
      ],
      // 人类：会说话、走动、战斗，也会递东西、拾取与换装；吹哨写在道具的词缀里。
      // 不偷东西，也不翻别人的行囊。
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
    },
    {
      stageKey: "graveyard",
      key: "eli",
      name: "拾骨人伊莱",
      profile: `**历史**: 你是拾骨人伊莱，替灰墙镇的骨炭窑收骨头。骨炭能滤水、压疫气，瘟疫之后骨头多得没人埋，价钱低，活也好找。你翻过塌墙进鸦葬岗，只想装满袋子，没打算招惹收尸的疯子或戴鸦羽的猎人。
**性格**: 谨慎、务实、嘴硬心软；先算退路，再算价钱。你不怕死人，怕活人。
**说话习惯/口音**: 河谷下游的口音，句子短，爱问“给多少钱”“往哪走”；紧张时会用玩笑挡过去。
**手段/路数**: 拾骨钩、短刀、绳子和一双认坟的眼；你能偷、能跑、能躲，不擅长正面拼命。
**戒备**: 有人举武器、或问你是不是来偷东西，你先退半步、把空手露出来；被堵住才动手。
**禁忌**: 不碰还热着的尸体，不抢活人嘴里的最后一口吃的；但死人身上的钥匙和骨牌，你会拿。
**最爱**: 装满的骨袋、火堆边的热汤。
**秘密**: 你脖子后面有一块黑疖病留下的疤，它没要你的命；你因此觉得墓园里的骨头不传染，也因此在别人都躲着的地方敢往里走。`,
      openingBriefing: `你翻过塌墙，进了鸦葬岗，想从旧坟里捡些骨头卖给骨炭窑。墓园里有一个拖着尸车的男人和一个戴鸦羽的女人；你都不认识。先别惊动他们，看清这里发生了什么，再决定要不要留下。`,
      signature: {
        form: formatForm(
          "人类",
          "中等身材，手指关节粗大，指甲缝里嵌着骨粉；背有点驼，左肩挂着一只补过的骨袋。",
        ),
        appearance:
          "粗布外衣上结着骨粉与蜡，左肩挂着一只补过三次的骨袋，袋口露出半截麻绳；脖子后面有一块发黑的旧疤。手指关节粗大，指甲缝里嵌着洗不掉的骨粉。",
      },
      hp: 20,
      stats: { maxHp: 20, strength: 10, wisdom: 4, agility: 6, damage: 0, block: 0 },
      isDefaultPlayer: true,
      equipment: {
        weapon: "拾骨钩",
        armor: "骨粉围裙",
        accessory: "拾骨袋",
      },
      inventory: [
        {
          key: "bone-hook",
          name: "拾骨钩",
          description: "一截弯成钩的旧铁，柄上缠着麻绳；钩尖磨得发亮，专用来从骨缝里把骨头勾出来。",
          kind: "weapon" as const,
          count: 1,
          stats: { damage: 5, block: 0 },
          actions: ["strike"],
          affixes: {
            strike: [
              {
                name: "打击",
                content: "钩尖勾住骨缝，造成 {{attack}} 点伤害",
                ops: [{ kind: "damage", amount: { ref: "attack" } }],
              },
              {
                name: "别住关节",
                mode: "agent",
                content:
                  "钩尖别住对方的关节或衣带：如果对方正在前冲，这一下会让他顿住半步，给旁人留出空当。",
              },
            ],
          },
        },
        {
          key: "bone-dust-apron",
          name: "骨粉围裙",
          description:
            "粗布围裙上结着一层骨粉与蜡，前襟硬得像块板；挡不住刀，但能挡住溅起来的骨渣。",
          kind: "equipment" as const,
          count: 1,
          stats: { block: 3 },
        },
        {
          key: "bone-sack",
          name: "拾骨袋",
          description: "一只补过三次的粗布袋，袋口用麻绳收着，里面积着骨粉和碎蜡。",
          kind: "accessory" as const,
          count: 1,
        },
      ],
      // 唯一会妙手的角色：看清、取走、对上机关是同一双手的事，其余能力与普通人类一致。
      proficiencies: [
        {
          key: "sleight",
          name: "妙手",
          description:
            "妙手空空：先扫一眼对方囊中有什么，再顺手把那件东西变成自己的；手里的东西该往哪道缝里送，也是同一双手的事。",
          actions: ["inspect", "steal", "fit"],
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
    },
  ],
  // 卡尔封过封尸窖，也锁过守夜塔的门：他记得这两处“封着的出口”，但进不去；
  // 薇拉与伊莱没有这份记忆，守夜塔与封尸窖对他们连“封着的出口”都不是。
  visitedStages: [
    { actor: "karl", stage: "watchtower" },
    { actor: "karl", stage: "plague-cellar" },
  ],
  // 开局既知：薇拉认得卡尔，卡尔疯了不认人，伊莱谁都不认得。
  signatureNames: [{ observer: "vela", subject: "karl", name: "卡尔" }],
  actions: ["notify_stage", "end_game"],
};
