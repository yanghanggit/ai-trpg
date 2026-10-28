import type { TraceContext } from "../../debug/trace";
import type { ToolDefinition } from "../../llm/types";
import { mentionOf, plainEntityName } from "../addressing";
import { appendPublicMessage, bumpGameVersion } from "../apply/messages";
import { resolveAdjacentStage } from "../apply/queries";
import type { ActorWithStageRow, Executor, ResolvedMove, WorldRow } from "../apply/types";
import { GameError } from "../errors";
import { renderAction, renderEnvironment } from "../observation-text";
import { appendCustomStageObservation, appendStageMemory } from "../observations";
import { moveActorToStage } from "../persistence/actors";
import { recordStageVisit } from "../persistence/visits";
import type { MoveAction } from "../types";

export function buildMoveTool(stageNames: readonly string[]): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "move",
      description: "把一次移动加入计划：沿场景连接前往一个相邻场景。",
      parameters: {
        type: "object",
        properties: {
          targetStageName: {
            type: "string",
            description: "要前往的相邻场景名",
            ...(stageNames.length > 0 ? { enum: [...stageNames] } : {}),
          },
        },
        required: ["targetStageName"],
      },
    },
  };
}

export function parseMove(args: Record<string, unknown>): MoveAction {
  const targetStageName =
    typeof args.targetStageName === "string" ? args.targetStageName.trim() : "";
  if (targetStageName.length === 0) {
    throw new GameError("invalid_action", "move 需要非空 targetStageName");
  }
  return { kind: "move", targetStageName };
}

export async function resolveMove(
  executor: Executor,
  world: WorldRow,
  stage: ResolvedMove["stage"],
  action: MoveAction,
): Promise<ResolvedMove> {
  const targetStage = await resolveAdjacentStage(executor, world, stage, action.targetStageName);
  return { kind: "move", action, stage, targetStage };
}

export async function applyMove(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedMove,
  now: Date,
  trace?: TraceContext,
): Promise<string> {
  const target = resolved.targetStage;
  // 离开观察要在移动前写：此时移动者仍在本场景，观察者才能拿到他的指代。
  await appendCustomStageObservation(
    executor,
    gameId,
    resolved.stage.id,
    actorRow.actor.id,
    (_observer, address) =>
      renderAction(
        `# 场景动态\n${mentionOf(address(actorRow.actor.id))}离开了${plainEntityName(resolved.stage.name)}。`,
        resolved.stage.id,
      ),
    trace,
  );
  await moveActorToStage(executor, actorRow.actor.id, target.id, now);
  await recordStageVisit(executor, gameId, actorRow.actor.id, target.id, now);
  await bumpGameVersion(executor, gameId, now);
  await appendPublicMessage(executor, gameId, actorRow.actor.id, {
    kind: "move",
    stageId: target.id,
    visibility: "stage",
    content: `${actorRow.actor.name}从${resolved.stage.name}走向${target.name}。`,
  });
  // 信息不对称：旧场景只知道「他走了」，新场景只知道「他来了」，完整路线只有移动者知道。
  const leaveText = `${actorRow.actor.name}离开了${resolved.stage.name}。`;
  const enterText = `${actorRow.actor.name}进入了${target.name}。`;

  // 此时移动者已在目标场景，所以不会被自己收到。
  await appendCustomStageObservation(
    executor,
    gameId,
    target.id,
    actorRow.actor.id,
    (_observer, address) =>
      renderEnvironment(
        `# 环境变化\n${mentionOf(address(actorRow.actor.id))}进入了${plainEntityName(target.name)}。`,
        target.id,
      ),
    trace,
  );
  await appendStageMemory(
    executor,
    gameId,
    resolved.stage.id,
    `# 场景事件\n${leaveText}`,
    {
      eventKind: "move_leave",
    },
    trace,
  );
  await appendStageMemory(
    executor,
    gameId,
    target.id,
    `# 场景事件\n${enterText}`,
    {
      eventKind: "move_enter",
    },
    trace,
  );
  return `# 行动结果\n你从${plainEntityName(resolved.stage.name)}抵达了${plainEntityName(target.name)}。`;
}
