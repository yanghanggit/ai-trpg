import type { TraceContext } from "../../debug/trace";
import type { ToolDefinition } from "../../llm/types";
import { allowedActionKinds } from "../actions";
import { assertNoSystemReference, isHandleRef } from "../addressing";
import { GameError } from "../errors";
import { resolveActorByNameInWorld, resolveEquippedItems } from "../lookup";
import { renderCall } from "../observation-text";
import { appendDirectObservation } from "../observations";
import { appendPublicMessage } from "../persistence/game-messages";
import { bumpGameVersion } from "../persistence/games";
import type { Executor, WorldRow } from "../persistence/rows";
import type { ResolvedCall } from "../settle/types";
import type { CallAction } from "../types";

/**
 * 用目标的真名跨场景传话。
 *
 * 这是控制面/测试动作：目标必须写 `actors.name`（真名），不接受 #编号 或 id。
 * 目标必须在其他场景，且双方都必须拥有 `call` 能力。只有目标听见；
 * 传音不在结构上携带发起人：来源身份只能由发起人自己写进 message。
 */
export function buildCallTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "call",
      description: "把一次跨场景传音加入计划：只有目标能听见。",
      parameters: {
        type: "object",
        properties: {
          mind: {
            type: "string",
            description: "第一人称内心独白，说明为什么这样说",
          },
          targetActorName: {
            type: "string",
            description: "目标的真名（不在当前场景、具备远程通讯能力；不是引用或 id）",
          },
          message: { type: "string", description: "你要说出的内容" },
        },
        required: ["mind", "targetActorName", "message"],
      },
    },
  };
}

export function parseCall(args: Record<string, unknown>): CallAction {
  const mind = typeof args.mind === "string" ? args.mind.trim() : "";
  const message = typeof args.message === "string" ? args.message : "";
  const targetActorName =
    typeof args.targetActorName === "string" ? args.targetActorName.trim() : "";
  if (mind.length === 0) {
    throw new GameError("invalid_action", "call 需要非空 mind");
  }
  if (message.trim().length === 0) {
    throw new GameError("invalid_action", "call 需要非空 message");
  }
  assertNoSystemReference(message);
  if (targetActorName.length === 0) {
    throw new GameError("invalid_action", "call 需要非空 targetActorName");
  }
  if (isHandleRef(targetActorName)) {
    throw new GameError("invalid_action", "call 的目标必须使用真名，不能用编号占位");
  }
  return { kind: "call", mind, targetActorName, message };
}

export async function resolveCall(
  executor: Executor,
  world: WorldRow,
  stage: ResolvedCall["stage"],
  actorId: string,
  action: CallAction,
): Promise<ResolvedCall> {
  assertNoSystemReference(action.message);
  if (isHandleRef(action.targetActorName)) {
    throw new GameError("invalid_action", "call 的目标必须使用真名，不能用编号占位");
  }
  const target = await resolveActorByNameInWorld(executor, world.id, action.targetActorName);
  if (target.actor.id === actorId) {
    throw new GameError("invalid_action", "call 的目标不能是自己");
  }
  if (target.stage.id === stage.id) {
    throw new GameError("invalid_action", "call 只能对不在当前场景的角色使用");
  }
  const targetGranted = (await resolveEquippedItems(executor, target.actor)).flatMap(
    (row) => row.actions,
  );
  if (!allowedActionKinds(target.actor.actions, targetGranted).includes("call")) {
    throw new GameError("invalid_action", `目标没有传音能力: ${target.actor.name}`);
  }
  return {
    kind: "call",
    action,
    stage,
    target: target.actor,
    targetStage: target.stage,
  };
}

export async function applyCall(
  executor: Executor,
  gameId: string,
  resolved: ResolvedCall,
  now: Date,
  trace?: TraceContext,
): Promise<string> {
  const target = resolved.target;
  const targetStage = resolved.targetStage;
  await bumpGameVersion(executor, gameId, now);
  await appendPublicMessage(executor, gameId, null, {
    kind: "call",
    stageId: targetStage.id,
    targetActorId: target.id,
    visibility: "private",
    content: `隔空传音给${target.name}：${resolved.action.message}`,
  });
  await appendDirectObservation(
    executor,
    gameId,
    targetStage.id,
    target.id,
    renderCall(targetStage, { target: { id: target.id }, message: resolved.action.message }),
    trace,
  );
  return `# 行动结果\n你把话传到了对方那里：${resolved.action.message}`;
}
