import type { ToolDefinition } from "../../llm/types";
import { appendPublicMessage, bumpGameVersion } from "../apply/messages";
import { resolveAdjacentStage } from "../apply/queries";
import type { ActorWithStageRow, Executor, ResolvedMove, WorldRow } from "../apply/types";
import { GameError } from "../errors";
import {
  appendActionObservations,
  appendEnvironmentObservations,
  appendStageEvent,
} from "../observations";
import { moveActorToStage } from "../persistence/actors";
import type { MoveAction } from "../types";

/** 构造 move 工具：沿连接移动到相邻场景。 */
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

/** 把 move 工具参数转成动作；只检查形状。 */
export function parseMove(args: Record<string, unknown>): MoveAction {
  const targetStageName =
    typeof args.targetStageName === "string" ? args.targetStageName.trim() : "";
  if (targetStageName.length === 0) {
    throw new GameError("invalid_action", "move 需要非空 targetStageName");
  }
  return { kind: "move", targetStageName };
}

/** 校验 move：目标场景存在且与当前场景有连接。 */
export async function resolveMove(
  executor: Executor,
  world: WorldRow,
  stage: ResolvedMove["stage"],
  action: MoveAction,
): Promise<ResolvedMove> {
  const targetStage = await resolveAdjacentStage(executor, world, stage, action.targetStageName);
  return { kind: "move", action, stage, targetStage };
}

/** 应用 move：更新场景、写移动事件与环境记忆。 */
export async function applyMove(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedMove,
  now: Date,
): Promise<string> {
  const target = resolved.targetStage;
  await moveActorToStage(executor, actorRow.actor.id, target.id, now);
  await bumpGameVersion(executor, gameId, now);
  await appendPublicMessage(executor, gameId, actorRow.actor.id, {
    kind: "move",
    stageId: target.id,
    visibility: "stage",
    content: `${actorRow.actor.name}从${resolved.stage.name}走向${target.name}。`,
  });
  // 信息不对称：旧场景只知道「他走了」，新场景只知道「他来了」，
  // 起点到终点的完整路线只有移动者自己知道（写进它的行动结果）。
  const leaveText = `${actorRow.actor.name}离开了${resolved.stage.name}。`;
  const enterText = `${actorRow.actor.name}进入了${target.name}。`;

  // 旧场景的旁观者：与 say / attack / give 共用同一个可见行动观察原语。
  // 此时移动者已经在目标场景，所以这里不会被自己收到。
  await appendActionObservations(
    executor,
    gameId,
    resolved.stage.id,
    actorRow.actor.id,
    `# 场景动态\n${leaveText}`,
  );
  await appendEnvironmentObservations(
    executor,
    gameId,
    target.id,
    actorRow.actor.id,
    `# 环境变化\n${enterText}`,
  );
  await appendStageEvent(executor, gameId, resolved.stage.id, `# 场景事件\n${leaveText}`, {
    eventKind: "move_leave",
  });
  await appendStageEvent(executor, gameId, target.id, `# 场景事件\n${enterText}`, {
    eventKind: "move_enter",
  });
  return `# 行动结果\n你从${resolved.stage.name}抵达了${target.name}。`;
}
