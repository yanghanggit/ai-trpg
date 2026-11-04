import type { Database } from "../db/pool";
import { adjacentStages, findActorByName } from "./actors";
import { addressLookupFor, handleOf, refOf } from "./addressing";
import { MEMORY_KINDS } from "./constants";
import { getMemoryState } from "./memory";
import { getGameStateSlice } from "./service";
import { visitedTeleportTargetsFor } from "./teleport";
import type { SignatureNameState } from "./types";

/**
 * 客户端用的「世界面」投影。
 *
 * 公共事件流的文本在写入时就已经带名字，无法可靠地事后脱敏；所以观看者视角直接
 * 读该 actor 的记忆——它本来就是为了这个观察者渲染的。这里只负责把记忆、场景与
 * 引用整理成稳定形状，不做新的过滤规则。
 */

export type ViewerAddress = {
  actorId: string;
  signatureId: string;
  /** 引用，例如 `#3`；客户端可以直接拿它提交行动。 */
  token: string;
  /** 观察者视角下的名单写法：`名字（此刻的样子）` 或只有外观。 */
  label: string;
  self: boolean;
  alive: boolean;
};

export type ViewerScene = {
  id: string;
  name: string;
  environment: string;
  items: { name: string; kind: string; description: string }[];
  actors: ViewerAddress[];
  /** 出口同时给真实场景名与 #实体序号，客户端可自行决定遮蔽。 */
  exits: { stageId: string; name: string; ref: string }[];
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
    signatureId: string;
    /** 自己的本名；自知不查名字表。 */
    name: string;
    appearance: string;
  };
  scene: ViewerScene | null;
  /** 这个观察者给各签名的当前称呼；其它观察者的名字不出现。 */
  signatureNames: SignatureNameState[];
  /** 这个角色实际感知到的记忆，按发生顺序。 */
  log: ViewerLogEntry[];
  /** 去过的场景（地图/记忆用）；不等于完整可传送列表。 */
  visitedStages: { stageId: string; name: string }[];
  /** 已去过且未被 teleport_blocked 的候选；不是完整的可传送集合。 */
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
  const state = await getGameStateSlice(db, gameRef);
  const { actor, stage } = findActorByName(state, actorRef);
  const memory = await getMemoryState(db, state.game.id, "actor", actor.id);
  const address = addressLookupFor(state, actor, stage);

  const actors: ViewerAddress[] = stage.actors.map((candidate) => {
    const entry = address(candidate.id);
    return {
      actorId: candidate.id,
      signatureId: candidate.signature.id,
      token: entry.token,
      label: refOf(entry),
      self: candidate.id === actor.id,
      alive: candidate.hp > 0,
    };
  });

  const stageById = new Map(state.world.stages.map((candidate) => [candidate.id, candidate]));
  const visitedStages = state.visits
    .filter((visit) => visit.actorId === actor.id)
    .flatMap((visit) => {
      const visited = stageById.get(visit.stageId);
      return visited ? [{ stageId: visited.id, name: visited.name }] : [];
    });
  const teleportTargets = visitedTeleportTargetsFor(state, actor, stage).map((target) => ({
    stageId: target.id,
    name: target.name,
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
      signatureId: actor.signature.id,
      name: actor.name,
      appearance: actor.appearance.text,
    },
    scene: {
      id: stage.id,
      name: stage.name,
      environment: stage.environment,
      items: stage.items.map((item) => ({
        name: item.name,
        kind: item.kind,
        description: item.description,
      })),
      actors,
      exits: adjacentStages(state, stage.id).map((exit) => ({
        stageId: exit.id,
        name: exit.name,
        ref: handleOf(exit.seq),
      })),
    },
    signatureNames: state.signatureNames.filter((row) => row.observerActorId === actor.id),
    log,
    visitedStages,
    teleportTargets,
  };
}
