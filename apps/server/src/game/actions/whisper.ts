import type { TraceContext } from "../../debug/trace";
import type { ToolDefinition } from "../../llm/types";
import { type AddressLookup, actionRef, HANDLE_PATTERN } from "../addressing";
import { appendPublicMessage, bumpGameVersion } from "../apply/messages";
import { findActorInStage } from "../apply/queries";
import type { ActorWithStageRow, Executor, ResolvedWhisper } from "../apply/types";
import { MAX_MIND_LENGTH } from "../constants";
import { GameError } from "../errors";
import { appendCommunicationObservations, appendStageMemory } from "../observations";
import type { WhisperAction } from "../types";

export function buildWhisperTool(targets: readonly string[]): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "whisper",
      description: "把一次耳语加入计划：对当前场景的一个具名角色低声说话，只有对方能听见。",
      parameters: {
        type: "object",
        properties: {
          mind: {
            type: "string",
            description: `第一人称内心独白，说明为什么这样说，控制在 ${MAX_MIND_LENGTH} 字以内`,
          },
          targetActorHandle: {
            type: "string",
            description: "当前场景内唯一的耳语对象：用 @数字 指代",
            ...(targets.length > 0 ? { enum: [...targets] } : {}),
          },
          message: { type: "string", description: "你要说出的内容" },
        },
        required: ["mind", "targetActorHandle", "message"],
      },
    },
  };
}

export function parseWhisper(args: Record<string, unknown>): WhisperAction {
  const mind = typeof args.mind === "string" ? args.mind.trim() : "";
  const message = typeof args.message === "string" ? args.message : "";
  const targetActorHandle =
    typeof args.targetActorHandle === "string" ? args.targetActorHandle.trim() : "";
  if (mind.length === 0) {
    throw new GameError("invalid_action", "whisper 需要非空 mind");
  }
  if (message.trim().length === 0) {
    throw new GameError("invalid_action", "whisper 需要非空 message");
  }
  if (HANDLE_PATTERN.test(message)) {
    throw new GameError("invalid_action", "message 里不能出现系统指代（@数字）");
  }
  if (targetActorHandle.length === 0) {
    throw new GameError("invalid_action", "whisper 需要非空 targetActorHandle");
  }
  return { kind: "whisper", mind, targetActorHandle, message };
}

export async function resolveWhisper(
  executor: Executor,
  stage: ResolvedWhisper["stage"],
  actorId: string,
  action: WhisperAction,
): Promise<ResolvedWhisper> {
  const target = await findActorInStage(executor, stage.id, action.targetActorHandle);
  if (target.id === actorId) {
    throw new GameError("invalid_action", "whisper 的目标不能是自己");
  }
  return { kind: "whisper", action, stage, target };
}

export async function applyWhisper(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedWhisper,
  now: Date,
  address: AddressLookup,
  trace?: TraceContext,
): Promise<string> {
  const source = { id: actorRow.actor.id, name: actorRow.actor.name };
  const target = { id: resolved.target.id, name: resolved.target.name };
  await bumpGameVersion(executor, gameId, now);
  await appendPublicMessage(executor, gameId, source.id, {
    kind: "whisper",
    stageId: resolved.stage.id,
    targetActorId: target.id,
    visibility: "private",
    content: `${source.name}对${target.name}耳语：${resolved.action.message}`,
  });
  await appendCommunicationObservations(
    executor,
    gameId,
    resolved.stage,
    {
      source,
      message: resolved.action.message,
      kind: "whisper",
      target,
    },
    trace,
  );
  await appendStageMemory(
    executor,
    gameId,
    resolved.stage.id,
    `# 场景事件\n${source.name}对${target.name}耳语。`,
    { eventKind: "whisper" },
    trace,
  );
  return `# 行动结果\n你对${actionRef(address(target.id))}耳语（场景：${resolved.stage.name}）：${resolved.action.message}`;
}
