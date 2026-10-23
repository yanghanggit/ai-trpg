import type { ToolDefinition } from "../../llm/types";
import { appendPublicMessage, bumpGameVersion } from "../apply/messages";
import type { ActorWithStageRow, Executor, ResolvedWait } from "../apply/types";
import { appendActionObservations, appendStageEvent } from "../observations";
import type { WaitAction } from "../types";

/** 构造 wait 工具：留在原地，不改变场景状态。 */
export function buildWaitTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "wait",
      description: "把一次等待加入计划：留在原地继续观察，不改变任何状态。",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  };
}

/** 把 wait 工具参数转成动作；wait 没有参数。 */
export function parseWait(): WaitAction {
  return { kind: "wait" };
}

/** 校验 wait：只需要当前场景。 */
export function resolveWait(stage: ResolvedWait["stage"], action: WaitAction): ResolvedWait {
  return { kind: "wait", action, stage };
}

/** 应用 wait：只写事件与观察，不改变状态。 */
export async function applyWait(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedWait,
  now: Date,
): Promise<string> {
  const content = `${actorRow.actor.name}留在原地，继续观察四周。`;
  await bumpGameVersion(executor, gameId, now);
  await appendPublicMessage(executor, gameId, actorRow.actor.id, {
    kind: "wait",
    stageId: resolved.stage.id,
    visibility: "stage",
    content,
  });
  await appendActionObservations(
    executor,
    gameId,
    resolved.stage.id,
    actorRow.actor.id,
    `# 场景动态\n${content}`,
  );
  await appendStageEvent(executor, gameId, resolved.stage.id, `# 场景事件\n${content}`, {
    eventKind: "wait",
  });
  return "# 行动结果\n你留在原地，继续观察四周。";
}
