import type { TraceContext } from "../../debug/trace";
import type { ToolDefinition } from "../../llm/types";
import { HANDLE_PATTERN } from "../addressing";
import { appendPublicMessage, bumpGameVersion } from "../apply/messages";
import type { ActorWithStageRow, Executor, ResolvedAnnounce } from "../apply/types";
import { MAX_MIND_LENGTH } from "../constants";
import { GameError } from "../errors";
import { appendCommunicationObservations, appendStageMemory } from "../observations";
import { hasCanonicalEntityName } from "../text-guard";
import type { AnnounceAction } from "../types";

export function buildAnnounceTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "announce",
      description: "把一次公开宣告加入计划：向当前场景的所有角色说话，没有指定对象。",
      parameters: {
        type: "object",
        properties: {
          mind: {
            type: "string",
            description: `第一人称内心独白，说明为什么这样说，控制在 ${MAX_MIND_LENGTH} 字以内`,
          },
          message: { type: "string", description: "你要说出的内容" },
        },
        required: ["mind", "message"],
      },
    },
  };
}

export function parseAnnounce(args: Record<string, unknown>): AnnounceAction {
  const mind = typeof args.mind === "string" ? args.mind.trim() : "";
  const message = typeof args.message === "string" ? args.message : "";
  if (mind.length === 0) {
    throw new GameError("invalid_action", "announce 需要非空 mind");
  }
  if (message.trim().length === 0) {
    throw new GameError("invalid_action", "announce 需要非空 message");
  }
  if (HANDLE_PATTERN.test(message)) {
    throw new GameError("invalid_action", "message 里不能出现系统指代（@数字）");
  }
  if (hasCanonicalEntityName(message)) {
    throw new GameError("invalid_action", "message 里不能出现类别.名称形式的规范名");
  }
  return { kind: "announce", mind, message };
}

export async function applyAnnounce(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedAnnounce,
  now: Date,
  trace?: TraceContext,
): Promise<string> {
  const source = { id: actorRow.actor.id, name: actorRow.actor.name };
  await bumpGameVersion(executor, gameId, now);
  await appendPublicMessage(executor, gameId, source.id, {
    kind: "announce",
    stageId: resolved.stage.id,
    visibility: "stage",
    content: `${source.name}公开说：${resolved.action.message}`,
  });
  await appendCommunicationObservations(
    executor,
    gameId,
    resolved.stage,
    {
      source,
      message: resolved.action.message,
      kind: "announce",
    },
    trace,
  );
  await appendStageMemory(
    executor,
    gameId,
    resolved.stage.id,
    `# 场景事件\n${source.name}公开说：${resolved.action.message}`,
    { eventKind: "announce" },
    trace,
  );
  return `# 行动结果\n你（场景：${resolved.stage.name}）公开说：${resolved.action.message}`;
}
