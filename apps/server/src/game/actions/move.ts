import { eq } from "drizzle-orm";
import { actors } from "../../db/schema";
import type { ToolDefinition } from "../../llm/types";
import { appendPublicMessage, bumpGameVersion } from "../apply/messages";
import { resolveAdjacentStage } from "../apply/queries";
import type { ActorWithStageRow, Executor, ResolvedMove, WorldRow } from "../apply/types";
import { GameError } from "../errors";
import { appendEnvironmentObservations, appendStageEvent } from "../observations";
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
  await executor
    .update(actors)
    .set({ stageId: target.id, updatedAt: now })
    .where(eq(actors.id, actorRow.actor.id));
  await bumpGameVersion(executor, gameId, now);
  await appendPublicMessage(executor, gameId, actorRow.actor.id, {
    kind: "move",
    stageId: target.id,
    visibility: "stage",
    content: `${actorRow.actor.name}从${resolved.stage.name}走向${target.name}。`,
  });
  await appendEnvironmentObservations(
    executor,
    gameId,
    target.id,
    actorRow.actor.id,
    `# 环境变化\n${actorRow.actor.name}从${resolved.stage.name}进入了${target.name}。`,
  );
  await appendStageEvent(
    executor,
    gameId,
    resolved.stage.id,
    `# 场景事件\n${actorRow.actor.name}离开${resolved.stage.name}，前往${target.name}。`,
    { eventKind: "move_leave" },
  );
  await appendStageEvent(
    executor,
    gameId,
    target.id,
    `# 场景事件\n${actorRow.actor.name}从${resolved.stage.name}进入${target.name}。`,
    { eventKind: "move_enter" },
  );
  return `# 行动结果\n你抵达了${target.name}。`;
}
