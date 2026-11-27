/**
 * 图谱：上帝视角的实体索引 —— 世界 → 舞台 → actor → 道具。
 *
 * 它是 `getGameStateSlice` 的另一个切面，不新增查询：同一份活状态，差别只在「不带的那些」——
 * 公共事件流（随长局无界增长）与世界级提示词（world 的系统宪法）。
 *
 * 舞台与 actor 摊平成两张表，靠 `stageId` 相连：客户端要按舞台分组、也要按顺位横着排，
 * 嵌套结构两边都得再拆一次。顺位另读一张快照：它回答「轮到谁」，不属于世界结构。
 *
 * 叶子实体（道具、装备、状态效果、属性）原样透传，字段不收窄——与建局数据同一条口径：
 * 翻译一层就少一层可信。
 */

import type { Database } from "../db/pool";
import {
  type ActionOrderRoundState,
  type ActionOrderState,
  getGameStateSlice,
  readActionOrder,
  readActionOrderRound,
} from "../game";

/** 通道的通行状态；`sealed` 表示剧情相连但此刻过不去。 */
export type GameGraphPassage = "open" | "sealed";

/** 原样透传的叶子行：道具、装备、属性、外观、状态效果。 */
export type GameGraphEntity = Record<string, unknown>;

export type GameGraphGame = {
  id: string;
  slug: string;
  name: string;
  status: string;
  outcome: string | null;
  /** 逻辑时钟：已落账的回合数。 */
  clock: number;
  version: number;
  contentVersion: string;
  updatedAt: string;
};

export type GameGraphWorld = {
  id: string;
  name: string;
  contentKey: string;
};

/** 舞台上的可交互锚点；挂在上面的道具跟在 `items` 里。 */
export type GameGraphAnchor = {
  key: string;
  label: string;
  description?: string;
  items: GameGraphEntity[];
};

export type GameGraphStage = {
  id: string;
  seq: number;
  key: string;
  name: string;
  ordinal: number;
  environment: string;
  teleportBlocked: boolean;
  /** 本舞台当前允许的动作。 */
  actions: string[];
  anchors: GameGraphAnchor[];
};

export type GameGraphConnection = {
  id: string;
  fromStageId: string;
  toStageId: string;
  passage: GameGraphPassage;
};

export type GameGraphActor = {
  id: string;
  seq: number;
  key: string;
  name: string;
  /** 所在舞台；画第二层时按它分组，不再从舞台那侧反查。 */
  stageId: string;
  hp: number;
  /** 从 `stats.maxHp` 提出来：血条与「还剩多少」都要读它，不该每处再翻一层。 */
  maxHp: number;
  stats: GameGraphEntity;
  concealed: boolean;
  isDefaultPlayer: boolean;
  appearance: GameGraphEntity;
  signature: { id: string; seq: number; form: string };
  equipment: GameGraphEntity;
  items: GameGraphEntity[];
  statusEffects: GameGraphEntity[];
  knowledgeAccess: string[];
  /** 角色固有的动作；武器授予的不在这里。 */
  actions: string[];
};

export type GameGraphData = {
  game: GameGraphGame;
  world: GameGraphWorld;
  stages: GameGraphStage[];
  connections: GameGraphConnection[];
  actors: GameGraphActor[];
  /** 当前进行中的顺位；没有就是 `null`，不是错误。 */
  order: ActionOrderState | null;
  /** 本行动轮的进度读数；与顺位并列，不嵌套。 */
  round: ActionOrderRoundState | null;
};

export async function readGameGraph(db: Database, gameRef: string): Promise<GameGraphData> {
  const state = await getGameStateSlice(db, gameRef);

  const order = await readActionOrder(db, state.game.id);

  return {
    game: {
      id: state.game.id,
      slug: state.game.slug,
      name: state.game.name,
      status: state.game.status,
      outcome: state.game.outcome,
      clock: state.game.clock,
      version: state.game.version,
      contentVersion: state.game.contentVersion,
      updatedAt: state.game.updatedAt,
    },
    world: {
      id: state.world.id,
      name: state.world.name,
      contentKey: state.world.contentKey,
    },
    stages: state.world.stages.map((stage) => ({
      id: stage.id,
      seq: stage.seq,
      key: stage.key,
      name: stage.name,
      ordinal: stage.ordinal,
      environment: stage.environment,
      teleportBlocked: stage.teleportBlocked,
      actions: [...stage.actions],
      anchors: stage.anchors.map((anchor) => ({
        key: anchor.key,
        label: anchor.label,
        ...(anchor.description === undefined ? {} : { description: anchor.description }),
        items: anchor.items,
      })),
    })),
    connections: state.world.connections.map((connection) => ({
      id: connection.id,
      fromStageId: connection.fromStageId,
      toStageId: connection.toStageId,
      passage: connection.passage,
    })),
    actors: state.world.stages.flatMap((stage) =>
      stage.actors.map((actor) => ({
        id: actor.id,
        seq: actor.seq,
        key: actor.key,
        name: actor.name,
        stageId: stage.id,
        hp: actor.hp,
        maxHp: actor.stats.maxHp,
        stats: actor.stats,
        concealed: actor.concealed,
        isDefaultPlayer: actor.isDefaultPlayer,
        appearance: actor.appearance,
        signature: actor.signature,
        equipment: actor.equipment,
        items: actor.items,
        statusEffects: [...actor.statusEffects],
        knowledgeAccess: [...actor.knowledgeAccess],
        actions: [...actor.actions],
      })),
    ),
    order,
    round: order === null ? null : await readActionOrderRound(db, order.id),
  };
}
