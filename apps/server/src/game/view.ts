import type { Database } from "../db/pool";
import { adjacentStages, findActorWithStage } from "./actors";
import { addressLookupFor, plainEntityName } from "./addressing";
import { MEMORY_KINDS } from "./constants";
import { getMemoryState } from "./memory";
import { getGameState } from "./service";
import { teleportTargetsFor } from "./teleport";
import type { NameKnowledgeState } from "./types";

/**
 * 客户端用的「世界面」投影。
 *
 * 公共事件流的文本在写入时就已经带规范名，无法可靠地事后脱敏；所以观看者视角直接
 * 读该 actor 的记忆——它本来就是为了这个观察者渲染的。这里只负责把记忆、场景与
 * 指代整理成稳定形状，不做新的过滤规则。
 */

export type ViewerAddress = {
  actorId: string;
  presentationId: string;
  /** 系统指代，例如 `@3`；客户端可以直接拿它提交行动。 */
  token: string;
  /** 观察者视角下的称呼：`名字（此刻的样子）` 或只有外观。 */
  label: string;
  knownName: string | null;
  self: boolean;
  alive: boolean;
};

export type ViewerScene = {
  id: string;
  name: string;
  environment: string;
  items: { name: string; kind: string; description: string }[];
  actors: ViewerAddress[];
  exits: { stageId: string; name: string }[];
};

export type ViewerLogEntry = {
  sequence: number;
  kind: string;
  content: string;
  createdAt: string;
};

export type ActorView = {
  game: {
    id: string;
    slug: string;
    status: string;
    version: number;
    contentVersion: string;
  };
  viewer: {
    actorId: string;
    presentationId: string;
    /** 自己的本名；自知不查称呼表。 */
    name: string;
    appearance: string;
  };
  scene: ViewerScene | null;
  /** 这个观察者已经知道的名字；其它观察者的信念不出现。 */
  knowledge: NameKnowledgeState[];
  /** 这个角色实际感知到的记忆，按发生顺序。 */
  log: ViewerLogEntry[];
  /** 去过的场景（地图/记忆用）；不表示现在可传送。 */
  visitedStages: { stageId: string; name: string }[];
  /** 当前可传送目标；只有去过且未被 teleport_blocked 的场景。 */
  teleportTargets: { stageId: string; name: string }[];
};

/** 属于“感知日志”的记忆类别；system prompt、开局简报与工具轨迹不在此列。 */
const LOG_KINDS = new Set<string>([
  MEMORY_KINDS.environmentObservation,
  MEMORY_KINDS.actionObservation,
  MEMORY_KINDS.communicationObservation,
  MEMORY_KINDS.actionFeedback,
  MEMORY_KINDS.actionRejected,
  MEMORY_KINDS.planFailed,
  MEMORY_KINDS.identityUpdate,
  MEMORY_KINDS.compactedMemory,
]);

function memoryKind(metadata: unknown): string {
  if (typeof metadata !== "object" || metadata === null) {
    return "";
  }
  const kind = (metadata as { kind?: unknown }).kind;
  return typeof kind === "string" ? kind : "";
}

export async function getActorView(
  db: Database,
  gameRef: string,
  actorRef: string,
): Promise<ActorView> {
  const state = await getGameState(db, gameRef);
  const { actor, stage } = findActorWithStage(state, actorRef);
  const memory = await getMemoryState(db, state.game.id, "actor", actor.id);
  const address = addressLookupFor(state, actor, stage);

  const actors: ViewerAddress[] = stage.actors.map((candidate) => {
    const entry = address(candidate.id);
    return {
      actorId: candidate.id,
      presentationId: candidate.presentation.id,
      token: entry.token,
      label: entry.label,
      knownName: entry.knownName,
      self: candidate.id === actor.id,
      alive: candidate.hp > 0,
    };
  });

  const stageById = new Map(state.world.stages.map((candidate) => [candidate.id, candidate]));
  const visitedStages = state.visits
    .filter((visit) => visit.actorId === actor.id)
    .flatMap((visit) => {
      const visited = stageById.get(visit.stageId);
      return visited ? [{ stageId: visited.id, name: plainEntityName(visited.name) }] : [];
    });
  const teleportTargets = teleportTargetsFor(state, actor, stage).map((target) => ({
    stageId: target.id,
    name: plainEntityName(target.name),
  }));

  const log: ViewerLogEntry[] = (memory?.messages ?? []).flatMap((message) => {
    if (message.type !== "human") {
      return [];
    }
    const kind = memoryKind(message.metadata);
    if (!LOG_KINDS.has(kind)) {
      return [];
    }
    return [
      {
        sequence: message.sequence,
        kind,
        content: message.content,
        createdAt: message.createdAt,
      },
    ];
  });

  return {
    game: {
      id: state.game.id,
      slug: state.game.slug,
      status: state.game.status,
      version: state.game.version,
      contentVersion: state.game.contentVersion,
    },
    viewer: {
      actorId: actor.id,
      presentationId: actor.presentation.id,
      name: plainEntityName(actor.name),
      appearance: actor.appearance,
    },
    scene: {
      id: stage.id,
      name: plainEntityName(stage.name),
      environment: stage.environment,
      items: stage.items.map((item) => ({
        name: plainEntityName(item.name),
        kind: item.kind,
        description: item.description,
      })),
      actors,
      exits: adjacentStages(state, stage.id).map((exit) => ({
        stageId: exit.id,
        name: plainEntityName(exit.name),
      })),
    },
    knowledge: state.knowledge.filter((row) => row.observerActorId === actor.id),
    log,
    visitedStages,
    teleportTargets,
  };
}
