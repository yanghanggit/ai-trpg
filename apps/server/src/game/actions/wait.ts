import type { TraceContext } from "../../debug/trace";
import type { ToolDefinition } from "../../llm/types";
import { mentionOf } from "../addressing";
import { appendPublicMessage, bumpGameVersion } from "../apply/messages";
import type { ActorWithStageRow, Executor, ResolvedWait } from "../apply/types";
import { renderAction, withAppearances } from "../observation-text";
import { appendCustomStageObservation, appendStageMemory } from "../observations";
import type { WaitAction } from "../types";

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

export function parseWait(): WaitAction {
  return { kind: "wait" };
}

export function resolveWait(stage: ResolvedWait["stage"], action: WaitAction): ResolvedWait {
  return { kind: "wait", action, stage };
}

export async function applyWait(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedWait,
  now: Date,
  trace?: TraceContext,
): Promise<string> {
  const content = `${actorRow.actor.name}留在原地，继续观察四周。`;
  await bumpGameVersion(executor, gameId, now);
  await appendPublicMessage(executor, gameId, actorRow.actor.id, {
    kind: "wait",
    stageId: resolved.stage.id,
    visibility: "stage",
    content,
  });
  await appendCustomStageObservation(
    executor,
    gameId,
    resolved.stage.id,
    actorRow.actor.id,
    (_observerId, address) =>
      renderAction(
        withAppearances(
          `# 场景动态\n${mentionOf(address(actorRow.actor.id))}留在原地，继续观察四周。`,
          [address(actorRow.actor.id)],
        ),
        resolved.stage.id,
      ),
    trace,
  );
  await appendStageMemory(
    executor,
    gameId,
    resolved.stage.id,
    `# 场景事件\n${content}`,
    {
      eventKind: "wait",
    },
    trace,
  );
  return "# 行动结果\n你留在原地，继续观察四周。";
}
