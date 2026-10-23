import type { ToolDefinition } from "../../llm/types";
import { appendPublicMessage, bumpGameVersion } from "../apply/messages";
import { findActorInStage } from "../apply/queries";
import type { ActorWithStageRow, Executor, ResolvedWhisper } from "../apply/types";
import { MAX_MIND_LENGTH } from "../constants";
import { GameError } from "../errors";
import { appendCommunicationObservations, appendStageEvent } from "../observations";
import type { WhisperAction } from "../types";

/** 构造 whisper 工具：对同场景一个具名角色耳语，只有对方能听见。 */
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
          targetActorName: {
            type: "string",
            description: "当前场景内唯一的耳语对象",
            ...(targets.length > 0 ? { enum: [...targets] } : {}),
          },
          message: { type: "string", description: "你要说出的内容" },
        },
        required: ["mind", "targetActorName", "message"],
      },
    },
  };
}

/** 把 whisper 工具参数转成动作；只检查形状。 */
export function parseWhisper(args: Record<string, unknown>): WhisperAction {
  const mind = typeof args.mind === "string" ? args.mind.trim() : "";
  const message = typeof args.message === "string" ? args.message : "";
  const targetActorName =
    typeof args.targetActorName === "string" ? args.targetActorName.trim() : "";
  if (mind.length === 0) {
    throw new GameError("invalid_action", "whisper 需要非空 mind");
  }
  if (message.trim().length === 0) {
    throw new GameError("invalid_action", "whisper 需要非空 message");
  }
  if (targetActorName.length === 0) {
    throw new GameError("invalid_action", "whisper 需要非空 targetActorName");
  }
  return { kind: "whisper", mind, targetActorName, message };
}

/** 校验 whisper 目标：同场景唯一角色，不能是自己。 */
export async function resolveWhisper(
  executor: Executor,
  stage: ResolvedWhisper["stage"],
  actorId: string,
  action: WhisperAction,
): Promise<ResolvedWhisper> {
  const target = await findActorInStage(executor, stage.id, action.targetActorName);
  if (target.id === actorId) {
    throw new GameError("invalid_action", "whisper 的目标不能是自己");
  }
  return { kind: "whisper", action, stage, target };
}

/** 应用 whisper：私密消息 + 只有目标收到观察。 */
export async function applyWhisper(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedWhisper,
  now: Date,
): Promise<string> {
  const speaker = { id: actorRow.actor.id, name: actorRow.actor.name };
  const target = { id: resolved.target.id, name: resolved.target.name };
  await bumpGameVersion(executor, gameId, now);
  await appendPublicMessage(executor, gameId, speaker.id, {
    kind: "whisper",
    stageId: resolved.stage.id,
    targetActorId: target.id,
    visibility: "private",
    content: `${speaker.name}对${target.name}耳语：${resolved.action.message}`,
  });
  await appendCommunicationObservations(
    executor,
    gameId,
    resolved.stage,
    speaker,
    "whisper",
    target,
    resolved.action.message,
  );
  await appendStageEvent(
    executor,
    gameId,
    resolved.stage.id,
    `# 场景事件\n${speaker.name}对${target.name}耳语。`,
    { eventKind: "whisper" },
  );
  return `# 行动结果\n你对${target.name}耳语（场景：${resolved.stage.name}）：${resolved.action.message}`;
}
