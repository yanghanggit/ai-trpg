import type { GameMessage } from "../../features/games/useGameMessages";
import type { GameView } from "../../features/games/useGameView";

/**
 * 局内页的 fixture：都是完整的观看者投影。
 *
 * 形状来自生成契约（`ActorView`），所以字段少了、可空性错了都在编译期发现——
 * 这正是 mock 与真数据共用一份契约的意思。
 */
const game = {
  id: "6f1c4f43-0000-4000-8000-00000000c001",
  name: "鸦葬岗的夜",
  slug: "crow-run-1",
  status: "active",
  version: 19,
  contentVersion: "crow-grave.v3",
};

const viewer = {
  actorId: "a1",
  signatureId: "s1",
  name: "拾骨人伊莱",
  appearance: "裹着旧斗篷的人，手上全是骨粉",
  concealed: false,
  hp: 9,
  stats: [
    { key: "maxHp", label: "最大生命", value: 12 },
    { key: "strength", label: "力量", value: 4 },
    { key: "wisdom", label: "智慧", value: 1 },
    { key: "agility", label: "敏捷", value: 3 },
  ],
  items: [
    {
      name: "拾骨钩",
      kind: "weapon",
      kindLabel: "武器",
      description: "弯钩磨得发亮，柄上缠着旧布条",
    },
    {
      name: "旧骨哨",
      kind: "accessory",
      kindLabel: "饰品",
      description: "吹起来像鸟叫",
    },
    {
      name: "半截蜡烛",
      kind: "consumable",
      kindLabel: "消耗品",
      description: "还能烧一个时辰",
    },
    {
      name: "锈铁扣",
      kind: "material",
      kindLabel: "材料",
      description: "不知道从哪件衣服上掉下来的",
    },
    {
      name: "塔门钥匙",
      kind: "valuable",
      kindLabel: "贵重品",
      description: "铜的，齿口磨平了一半",
    },
  ],
};

export const gameFixtures = {
  /** 局中：有锚点、有同伴、有日志、有两个出口。 */
  active: {
    game,
    viewer,
    stage: {
      id: "st1",
      name: "鸦葬岗",
      environment: "坡地上插满木杆，风一过，挂在上面的东西一起响。",
      anchors: [
        {
          key: "pole",
          label: "最高的木杆",
          description: "杆上挂着褪色的布条",
          items: [
            {
              name: "旧骨哨",
              kind: "accessory",
              kindLabel: "饰品",
              description: "吹起来像鸟叫",
            },
          ],
        },
        { key: "pit", label: "新挖的坑", items: [] },
      ],
      actors: [
        {
          actorId: "a1",
          signatureId: "s1",
          token: "#1",
          name: "拾骨人伊莱",
          appearance: "裹着旧斗篷的人，手上全是骨粉",
          self: true,
          alive: true,
        },
        {
          actorId: "a2",
          signatureId: "s2",
          token: "#2",
          name: "收尸人卡尔",
          appearance: "浸过石灰的粗布围裙上结着黑蜡与骨渣；左眼被一块黑蜡封住",
          self: false,
          alive: true,
        },
      ],
      exits: [
        { stageId: "st2", name: "守夜塔", ref: "#4" },
        { stageId: "st3", name: "封尸窖", ref: "#5" },
      ],
      sealedExits: [],
    },
    names: [
      {
        name: "收尸人卡尔",
        token: "#2",
        form: "人类:瘦高，左眼被蜡封住",
        source: "content",
        learnedAt: null,
      },
      {
        name: "塔下那个人",
        token: "#8",
        form: "人类:浸过石灰的粗布围裙",
        source: "self",
        learnedAt: "鸦葬岗",
      },
    ],
    visitedStages: [
      { stageId: "st1", name: "鸦葬岗" },
      { stageId: "st2", name: "守夜塔" },
    ],
  },

  /** 刚开局：没有同伴、没有历史，渲染空态。 */
  fresh: {
    game: { ...game, name: "未命名的一局", slug: "mock-fresh", version: 0 },
    viewer,
    stage: {
      id: "st9",
      name: "墓园",
      environment: "矮墙围着一片斜坡，草刚被雨压平。",
      anchors: [],
      actors: [
        {
          actorId: "a1",
          signatureId: "s1",
          token: "#1",
          name: "拾骨人伊莱",
          appearance: "裹着旧斗篷的人，手上全是骨粉",
          self: true,
          alive: true,
        },
      ],
      exits: [{ stageId: "st1", name: "鸦葬岗", ref: "#2" }],
      sealedExits: [],
    },
    names: [],
    visitedStages: [{ stageId: "st9", name: "墓园" }],
  },

  /** 收束：出口封上、同伴已死、自己隐匿。 */
  sealed: {
    game: { ...game, name: "封尸窖的尽头", slug: "mock-sealed", status: "completed", version: 63 },
    viewer: { ...viewer, concealed: true },
    stage: {
      id: "st3",
      name: "封尸窖",
      environment: "石台上摞着封好的尸体，地面往下渗水。",
      anchors: [
        { key: "slab", label: "石台", description: "台面刻着名字，最新那个还没刻完", items: [] },
      ],
      actors: [
        {
          actorId: "a1",
          signatureId: "s1",
          token: "#1",
          name: "拾骨人伊莱",
          appearance: "裹着旧斗篷的人，手上全是骨粉",
          self: true,
          alive: true,
        },
        {
          actorId: "a2",
          signatureId: "s2",
          token: "#2",
          name: "收尸人卡尔",
          appearance: "倒在石台边，围裙上的黑蜡被血冲开了一半",
          self: false,
          alive: false,
        },
      ],
      exits: [],
      sealedExits: [{ stageId: "st1", name: "鸦葬岗" }],
    },
    names: [],
    visitedStages: [
      { stageId: "st1", name: "鸦葬岗" },
      { stageId: "st3", name: "封尸窖" },
    ],
  },
} satisfies Record<string, GameView>;

export type GameMockState = keyof typeof gameFixtures;

/** 「记录」浮窗的 fixture：与页面状态同名，打开时按状态给一条流。 */
export const gameHistoryFixtures: Record<GameMockState, GameMessage[]> = {
  // 18 条：侧板只有一屏高，这个量能真的上下滚一滚。
  active: [
    message(1, "stage_opening", "鸦葬岗的夜开始了。坡上的木杆在风里响。"),
    message(2, "environment_observation", "风把木杆上的布条吹得笔直，指向坡下。"),
    message(3, "communication", "「今晚别往窖里去。」卡尔说完就笑了。", { sourceActorId: "a2" }),
    message(4, "action_observation", "卡尔把一具尸体拖到坑边，抬头看了你一眼。", {
      sourceActorId: "a2",
    }),
    message(5, "movement", "你走到最高的木杆底下。布条扫过你的额头，是湿的。"),
    message(6, "environment_observation", "坑底有东西在动，细看是水在渗。"),
    message(7, "communication", "「拾骨的，帮我把绳子解开。」卡尔的声音从坑那边过来。", {
      sourceActorId: "a2",
    }),
    message(8, "action_feedback", "你蹲下去解绳结，麻绳吃透了水，一拉一手黑。"),
    message(9, "action_observation", "薇拉从塔门那边过来，鸦站在她肩上，头一直偏着。", {
      sourceActorId: "a3",
    }),
    message(10, "communication", "「他今晚挖的是第四个。」薇拉说，声音压得很低。", {
      sourceActorId: "a3",
      targetActorId: "a1",
    }),
    message(11, "identity_update", "你知道了她的名字：鸦猎薇拉。", { visibility: "private" }),
    message(12, "environment_observation", "雾从坡下的石阶那边漫上来，先湿了脚背。"),
    message(13, "action_observation", "卡尔把锤子插进土里，蹲在坟前不说话。", {
      sourceActorId: "a2",
    }),
    message(14, "route_failed", "石阶的断口在雾里断了，你退回来一步。"),
    message(15, "communication", "「别数了。」薇拉说，「数到五，雾就到腰了。」", {
      sourceActorId: "a3",
    }),
    message(16, "world_notification", "夜往深里走了一层。"),
    message(17, "action_observation", "坑边多了一块没写字的木牌，是新的。", {
      sourceActorId: "a2",
    }),
    message(18, "stage_observation", "木杆还在响，但节奏变了，慢下来了。"),
  ],
  fresh: [],
  sealed: [
    {
      id: "m41",
      sequence: 41,
      kind: "action_feedback",
      stageId: "st3",
      sourceActorId: "a1",
      targetActorId: null,
      visibility: "stage",
      content: "铁闸门在你身后落下，锁扣咬住了。",
      createdAt: "2026-01-02T12:20:00.000Z",
    },
  ],
};

/**
 * 事件流的一行：只写有变化的部分，其余按「发生在鸦葬岗、公开、无人称」补齐。
 *
 * 这样加一条等于加一行，而不用把 9 个字段抄一遍。
 */
function message(
  sequence: number,
  kind: string,
  content: string,
  extra: Partial<GameMessage> = {},
): GameMessage {
  return {
    id: `m${sequence}`,
    sequence,
    kind,
    stageId: "st1",
    sourceActorId: null,
    targetActorId: null,
    visibility: "stage",
    content,
    createdAt: `2026-01-02T10:${String(sequence).padStart(2, "0")}:00.000Z`,
    ...extra,
  };
}
