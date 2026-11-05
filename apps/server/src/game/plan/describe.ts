import {
  type ActorWithStage,
  adjacentStageNames,
  adjacentStages,
  findStageByName,
  sealedStages,
} from "../actors";
import { type AddressLookup, addressLookupFor, refOf } from "../addressing";
import { isAlive } from "../apply/queries";
import { handleOf } from "../reference";
import { visitedStageIds, visitedStagesForActor, visitedTeleportTargetsFor } from "../teleport";
import { sanitizeActorFacingText } from "../text-guard";
import type { ActorState, GameStateSlice, ItemState, StageAnchorState, StageState } from "../types";
import { EQUIPMENT_SLOT_LABELS, EQUIPMENT_SLOTS } from "../types";

/** 场景锚点的统一渲染：stage 与 actor 都看同一份公开列表，物品作为子项挂在锚点下。 */
export function describeStageAnchors(anchors: readonly StageAnchorState[]): string {
  if (anchors.length === 0) {
    return "无";
  }
  return anchors
    .flatMap((anchor) => {
      const head = anchor.description
        ? `- ${anchor.label}：${anchor.description}`
        : `- ${anchor.label}`;
      const items = anchor.items.map(
        (item) => `  - ${item.name}（${item.kind}${itemSourceNote(item)}）：${item.description}`,
      );
      return [head, ...items];
    })
    .join("\n");
}

/** 场景里可拾取的物品名：物品挂在锚点上，顺序沿用锚点与物品的稳定序号。 */
export function stageItemNames(stage: Pick<StageState, "anchors">): string[] {
  return stage.anchors.flatMap((anchor) => anchor.items.map((item) => item.name));
}

/**
 * 只列参与结算的两项，免得模型据此推断出不存在的战斗机制。
 */
export function describeStats(actor: ActorState): string {
  return `角色：${actor.name}
HP：${actor.hp}/${actor.stats.maxHp}
damage：${actor.stats.damage}
block：${actor.stats.block}
状态：${isAlive(actor) ? "存活" : "已死亡"}`;
}

/** 材料的来源只对 material 有意义；其它大类不展示多余的字段。 */
function itemSourceNote(item: ItemState): string {
  return item.kind === "material" && item.source ? `，源自 ${item.source}` : "";
}

export function describeItems(actor: Pick<ActorState, "items" | "equipment">): string {
  if (actor.items.length === 0) {
    return "物品：无";
  }
  const lines = actor.items.map((item) => {
    const { damage, block } = item.stats;
    const notes: string[] = [];
    if (damage > 0 || block > 0) {
      notes.push(`damage ${damage}`, `block ${block}`);
    }
    // 物品提供的动作只在穿戴时生效；写出来，模型才知道能否挥击、卸下会失去什么。
    if (item.actions.length > 0) {
      notes.push(`提供 ${item.actions.join("、")}`);
    }
    const stats = notes.length > 0 ? `（${notes.join("，")}）` : "";
    const worn = Object.values(actor.equipment).includes(item.name) ? "，已穿戴" : "";
    return `- ${item.name}（${item.kind}，count ${item.count}${itemSourceNote(item)}${worn}）：${item.description}${stats}`;
  });
  return `物品：
${lines.join("\n")}`;
}

export function describeEquipment(actor: Pick<ActorState, "equipment">): string {
  const lines = EQUIPMENT_SLOTS.flatMap((slot) => {
    const itemName = actor.equipment[slot];
    return itemName ? [`- ${EQUIPMENT_SLOT_LABELS[slot]}：${itemName}`] : [];
  });
  return lines.length === 0 ? "穿戴：无" : `穿戴：\n${lines.join("\n")}`;
}

/**
 * 同场景角色名单里的穿戴摘要：一行只列已穿戴的槽位。
 *
 * 与 `describeEquipment` 的区别是给名单内联用；没穿东西时返回空串。
 * 完整背包（含未穿戴物品与数值）仍走 `observe_actor`。
 */
export function describeEquipmentBrief(actor: Pick<ActorState, "equipment">): string {
  return EQUIPMENT_SLOTS.flatMap((slot) => {
    const itemName = actor.equipment[slot];
    return itemName ? [`${EQUIPMENT_SLOT_LABELS[slot]}：${itemName}`] : [];
  }).join("；");
}

export function describeSelf(actor: ActorState): string {
  return `外观：${actor.appearance.text}
${describeStats(actor)}
${describeEquipment(actor)}
${describeItems(actor)}`;
}

/** 不传 address 时使用 god-view 真名（stage / world 与测试）；actor 路径必须传。 */
export function describeObservedActor(actor: ActorState, address?: AddressLookup): string {
  const ref = address ? refOf(address(actor.id)) : actor.name;
  return `${ref}携带：
${describeItems(actor)}`;
}

/**
 * 把 environment 渲染成某个 actor 能读的版本。
 *
 * 回合初始输入与 `look_stage` 共用：environment 是拉取入口，读取时按观察者再脱敏
 * 一次，不能只依赖写入守卫（建局数据与历史数据都可能绕过守卫）。
 */
export function renderStageEnvironmentForActor(
  state: GameStateSlice,
  current: ActorWithStage,
): string {
  const stage = current.stage;
  const address = addressLookupFor(state, current.actor, stage);
  const otherActorNames = state.world.stages
    .flatMap((candidate) => candidate.actors)
    .filter((actor) => !stage.actors.some((present) => present.id === actor.id))
    .map((actor) => actor.name);
  return sanitizeActorFacingText(stage.environment, stage.actors, address, otherActorNames);
}

/** 锚点连物品一起给；只列标签会丢掉 use 与 pickup 需要的细节。 */
function describeStageAnchorsSection(anchors: readonly StageAnchorState[]): string {
  return anchors.length === 0 ? "可交互：无" : `可交互：\n${describeStageAnchors(anchors)}`;
}

/**
 * actor 视角的可去方向：去过的写名字，没走过的只给实体编号。
 *
 * 名字只来自到访（`stage_visits`）：没走过的场景就是 `#序号`，即使离开场简报里
 * 或别人嘴里听过这个名字——文本不构成结构化的地名知识。
 */
export function adjacentStageRefsForActor(
  state: GameStateSlice,
  current: ActorWithStage,
): string[] {
  const visited = visitedStageIds(state, current.actor.id);
  return adjacentStages(state, current.stage.id).map((stage) =>
    visited.has(stage.id) ? stage.name : handleOf(stage.seq),
  );
}

/**
 * 封着、但自己去过的出口：记忆里的一道门。
 *
 * 到访是记忆，不是通行证。去过的地方即使现在过不去，也认得出它在哪儿；
 * 没走过的门连名字都不知道，自然也无从记得。
 */
export function sealedVisitedStagesForActor(
  state: GameStateSlice,
  current: ActorWithStage,
): StageState[] {
  const visited = visitedStageIds(state, current.actor.id);
  return sealedStages(state, current.stage.id).filter((stage) => visited.has(stage.id));
}

export function sealedVisitedStageRefsForActor(
  state: GameStateSlice,
  current: ActorWithStage,
): string[] {
  return sealedVisitedStagesForActor(state, current).map((stage) => stage.name);
}

/** actor 视角的场景视图：只读当前场景，名字走观察者相对的引用。 */
export function describeStageForActor(state: GameStateSlice, current: ActorWithStage): string {
  const stage = current.stage;
  const address = addressLookupFor(state, current.actor, stage);
  const moves = adjacentStageRefsForActor(state, current);
  const remembered = sealedVisitedStageRefsForActor(state, current);
  const canTeleport = current.actor.actions.includes("teleport");
  const teleportLines = visitedTeleportTargetsFor(state, current.actor, stage)
    .map((candidate) => candidate.name)
    .join("、");
  const actors =
    stage.actors.length === 0
      ? "无"
      : stage.actors
          .map((actor) => {
            const worn = describeEquipmentBrief(actor);
            const dead = isAlive(actor) ? "" : "（已死亡）";
            return `${refOf(address(actor.id))}${dead}${worn.length === 0 ? "" : `｜${worn}`}`;
          })
          .join("、");
  return `场景：${stage.name}
${renderStageEnvironmentForActor(state, current)}
角色：${actors}
${describeStageAnchorsSection(stage.anchors)}
可去：${moves.length === 0 ? "无" : moves.join("、")}${
    remembered.length === 0 ? "" : `\n记得封着：${remembered.join("、")}`
  }${
    canTeleport
      ? `
可传送（写对真名即可；下列是去过的、未禁传）：${teleportLines.length === 0 ? "无" : teleportLines}`
      : ""
  }`;
}

/**
 * 去过哪些场景。顺序直接沿用 `state.visits`（并列时已按场景序号兜底），
 * 这里不再重排，避开两处排序规则漂移。
 */
export function describeVisitedStages(
  state: GameStateSlice,
  actorId: string,
  currentStageId?: string,
): string {
  const visited = visitedStagesForActor(state, actorId);
  const lines =
    visited.length === 0
      ? "无"
      : visited
          .map((stage) => `${stage.name}${stage.id === currentStageId ? "（当前）" : ""}`)
          .join("\n");
  return `# 你去过的场景
${lines}`;
}

/** world 视角：可查看任意场景，名字与 environment 原样输出。 */
export function describeStageForWorld(state: GameStateSlice, stageName: string): string {
  const stage = findStageByName(state, stageName);
  if (!stage) {
    return `错误：场景不存在 ${stageName}`;
  }
  const moves = adjacentStageNames(state, stage.id);
  const actors =
    stage.actors.length === 0
      ? "无"
      : stage.actors
          .map((actor) => `${actor.name}${isAlive(actor) ? "" : "（已死亡）"}`)
          .join("、");
  return `场景：${stage.name}
${stage.profile}
${stage.environment}
角色：${actors}
${describeStageAnchorsSection(stage.anchors)}
可去：${moves.length === 0 ? "无" : moves.join("、")}`;
}
