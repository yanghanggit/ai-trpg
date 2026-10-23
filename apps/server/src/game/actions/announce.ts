import type { ToolDefinition } from "../../llm/types";
import { appendPublicMessage, bumpGameVersion } from "../apply/messages";
import type { ActorWithStageRow, Executor, ResolvedAnnounce } from "../apply/types";
import { MAX_MIND_LENGTH } from "../constants";
import { GameError } from "../errors";
import { appendCommunicationObservations, appendStageEvent } from "../observations";
import type { AnnounceAction } from "../types";

/** 构造 announce 工具：向当前场景公开说话，没有指定对象。 */
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

/** 把 announce 工具参数转成动作；只检查形状。 */
export function parseAnnounce(args: Record<string, unknown>): AnnounceAction {
  const mind = typeof args.mind === "string" ? args.mind.trim() : "";
  const message = typeof args.message === "string" ? args.message : "";
  if (mind.length === 0) {
    throw new GameError("invalid_action", "announce 需要非空 mind");
  }
  if (message.trim().length === 0) {
    throw new GameError("invalid_action", "announce 需要非空 message");
  }
  return { kind: "announce", mind, message };
}

/** 应用 announce：场景公开消息 + 全体听觉观察。 */
export async function applyAnnounce(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedAnnounce,
  now: Date,
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
    source,
    "announce",
    undefined,
    resolved.action.message,
  );
  await appendStageEvent(
    executor,
    gameId,
    resolved.stage.id,
    `# 场景事件\n${source.name}公开说：${resolved.action.message}`,
    { eventKind: "announce" },
  );
  return `# 行动结果\n你（场景：${resolved.stage.name}）公开说：${resolved.action.message}`;
}
