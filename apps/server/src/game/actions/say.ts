import type { TraceContext } from "../../debug/trace";
import type { ToolDefinition } from "../../llm/types";
import { GameError } from "../errors";
import { type AddressLookup, actionRef, assertNoSystemReference } from "../kernel/addressing";
import type { SayAction } from "../kernel/types";
import { appendCommunicationObservations, appendStageMemory } from "../observations";
import { appendPublicMessage } from "../persistence/game-messages";
import { bumpGameVersion } from "../persistence/games";
import type { ActorWithStageRow, Executor } from "../persistence/rows";
import type { ResolvedSay } from "../settle/types";

export function buildSayTool(targets: readonly string[]): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "say",
      description: "把一次公开说话加入计划：对当前舞台的一个角色说一句话，舞台内其他角色也能听见。",
      parameters: {
        type: "object",
        properties: {
          mind: {
            type: "string",
            description: "第一人称内心独白，说明为什么这样说",
          },
          targetActorHandle: {
            type: "string",
            description: "当前舞台内唯一的说话对象：用同舞台角色列表里的名字 或 #编号 引用",
            ...(targets.length > 0 ? { enum: [...targets] } : {}),
          },
          message: { type: "string", description: "你要说出的内容" },
        },
        required: ["mind", "targetActorHandle", "message"],
      },
    },
  };
}

export function parseSay(args: Record<string, unknown>): SayAction {
  const mind = typeof args.mind === "string" ? args.mind.trim() : "";
  const message = typeof args.message === "string" ? args.message : "";
  const targetActorHandle =
    typeof args.targetActorHandle === "string" ? args.targetActorHandle.trim() : "";
  if (mind.length === 0) {
    throw new GameError("invalid_action", "say 需要非空 mind");
  }
  if (message.trim().length === 0) {
    throw new GameError("invalid_action", "say 需要非空 message");
  }
  assertNoSystemReference(message);
  if (targetActorHandle.length === 0) {
    throw new GameError("invalid_action", "say 需要非空 targetActorHandle");
  }
  return { kind: "say", mind, targetActorHandle, message };
}

export function resolveSay(
  stage: ResolvedSay["stage"],
  actorId: string,
  action: SayAction,
  target: ResolvedSay["target"],
): ResolvedSay {
  assertNoSystemReference(action.message);
  if (target.id === actorId) {
    throw new GameError("invalid_action", "say 的目标不能是自己");
  }
  return { kind: "say", action, stage, target };
}

export async function applySay(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedSay,
  now: Date,
  address: AddressLookup,
  trace?: TraceContext,
): Promise<string> {
  const source = { id: actorRow.actor.id, name: actorRow.actor.name };
  const target = { id: resolved.target.id, name: resolved.target.name };
  await bumpGameVersion(executor, gameId, now);
  await appendPublicMessage(executor, gameId, source.id, {
    kind: "say",
    stageId: resolved.stage.id,
    targetActorId: target.id,
    visibility: "stage",
    content: `${source.name}对${target.name}说：${resolved.action.message}`,
  });
  await appendCommunicationObservations(
    executor,
    gameId,
    resolved.stage,
    {
      source,
      message: resolved.action.message,
      kind: "say",
      target,
    },
    trace,
  );
  await appendStageMemory(
    executor,
    gameId,
    resolved.stage.id,
    `# 舞台事件\n${source.name}对${target.name}说：${resolved.action.message}`,
    { eventKind: "say" },
    trace,
  );
  return `# 行动结果\n你对${actionRef(address(target.id))}说（舞台：${resolved.stage.name}）：${resolved.action.message}`;
}
