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
          items: [{ name: "旧骨哨", kind: "accessory", description: "吹起来像鸟叫" }],
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
  active: [
    {
      id: "m1",
      sequence: 1,
      kind: "stage_opening",
      stageId: "st1",
      sourceActorId: null,
      targetActorId: null,
      visibility: "stage",
      content: "鸦葬岗的夜开始了。坡上的木杆在风里响。",
      createdAt: "2026-01-02T10:00:00.000Z",
    },
    {
      id: "m2",
      sequence: 2,
      kind: "environment_observation",
      stageId: "st1",
      sourceActorId: null,
      targetActorId: "a1",
      visibility: "stage",
      content: "风把木杆上的布条吹得笔直，指向坡下。",
      createdAt: "2026-01-02T10:00:03.000Z",
    },
    {
      id: "m3",
      sequence: 3,
      kind: "communication",
      stageId: "st1",
      sourceActorId: "a2",
      targetActorId: "a1",
      visibility: "stage",
      content: "「今晚别往窖里去。」卡尔说完就笑了。",
      createdAt: "2026-01-02T10:02:41.000Z",
    },
    {
      id: "m4",
      sequence: 4,
      kind: "action_observation",
      stageId: "st1",
      sourceActorId: "a2",
      targetActorId: null,
      visibility: "stage",
      content: "卡尔把一具尸体拖到坑边，抬头看了你一眼。",
      createdAt: "2026-01-02T10:04:11.000Z",
    },
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
