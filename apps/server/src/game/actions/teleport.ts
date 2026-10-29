import type { TraceContext } from "../../debug/trace";
import type { ToolDefinition } from "../../llm/types";
import { mentionOf, plainEntityName } from "../addressing";
import { appendPublicMessage, bumpGameVersion } from "../apply/messages";
import { findStageInWorld } from "../apply/queries";
import type { ActorWithStageRow, Executor, ResolvedTeleport, WorldRow } from "../apply/types";
import { GameError } from "../errors";
import { renderAction, renderEnvironmentChange, withAppearances } from "../observation-text";
import { appendCustomStageObservation, appendStageMemory } from "../observations";
import { moveActorToStage } from "../persistence/actors";
import { hasStageVisit, recordStageVisit } from "../persistence/visits";
import type { TeleportAction } from "../types";

export function buildTeleportTool(stageNames: readonly string[]): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "teleport",
      description:
        "传送到一个你去过、且未被禁传的场景。一次跳跃，不沿路径移动，也不产生中间场景的观察。",
      parameters: {
        type: "object",
        properties: {
          targetStageName: {
            type: "string",
            description: "要传送到的已访问场景；只能从本工具给出的列表里选择",
            ...(stageNames.length > 0 ? { enum: [...stageNames] } : {}),
          },
        },
        required: ["targetStageName"],
      },
    },
  };
}

export function parseTeleport(args: Record<string, unknown>): TeleportAction {
  const targetStageName =
    typeof args.targetStageName === "string" ? args.targetStageName.trim() : "";
  if (targetStageName.length === 0) {
    throw new GameError("invalid_action", "teleport 需要非空 targetStageName");
  }
  return { kind: "teleport", targetStageName };
}

export async function resolveTeleport(
  executor: Executor,
  world: WorldRow,
  stage: ResolvedTeleport["stage"],
  actorId: string,
  action: TeleportAction,
): Promise<ResolvedTeleport> {
  const targetStage = await findStageInWorld(executor, world.id, action.targetStageName);
  if (!targetStage) {
    throw new GameError("invalid_action", `目标场景不存在: ${action.targetStageName}`);
  }
  if (targetStage.id === stage.id) {
    throw new GameError("invalid_action", "不能传送到当前场景");
  }
  if (stage.teleportBlocked) {
    throw new GameError("invalid_action", `当前场景禁止传送: ${plainEntityName(stage.name)}`);
  }
  if (targetStage.teleportBlocked) {
    throw new GameError("invalid_action", `目标场景禁止传送: ${plainEntityName(targetStage.name)}`);
  }
  if (!(await hasStageVisit(executor, actorId, targetStage.id))) {
    throw new GameError("invalid_action", `你没有去过 ${plainEntityName(targetStage.name)}`);
  }
  return { kind: "teleport", action, stage, targetStage };
}

export async function applyTeleport(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedTeleport,
  now: Date,
  trace?: TraceContext,
): Promise<string> {
  const target = resolved.targetStage;
  const actorName = plainEntityName(actorRow.actor.name);
  const sourceName = plainEntityName(resolved.stage.name);
  const targetName = plainEntityName(target.name);

  // 离开与到达是瞬时事实：源场景看到消失，目标场景看到出现。
  await appendCustomStageObservation(
    executor,
    gameId,
    resolved.stage.id,
    actorRow.actor.id,
    (_observer, address) =>
      renderAction(
        withAppearances(`# 场景动态\n${mentionOf(address(actorRow.actor.id))}在原地消失了。`, [
          address(actorRow.actor.id),
        ]),
        resolved.stage.id,
      ),
    trace,
  );
  await moveActorToStage(executor, actorRow.actor.id, target.id, now);
  await recordStageVisit(executor, gameId, actorRow.actor.id, target.id, now);
  await bumpGameVersion(executor, gameId, now);
  await appendPublicMessage(executor, gameId, actorRow.actor.id, {
    kind: "teleport",
    stageId: target.id,
    visibility: "stage",
    content: `${actorRow.actor.name}从${resolved.stage.name}传送到${target.name}。`,
  });
  await appendCustomStageObservation(
    executor,
    gameId,
    target.id,
    actorRow.actor.id,
    (_observer, address) =>
      renderEnvironmentChange(
        withAppearances(`# 环境变化\n${mentionOf(address(actorRow.actor.id))}出现在这里。`, [
          address(actorRow.actor.id),
        ]),
        target.id,
      ),
    trace,
  );
  await appendStageMemory(
    executor,
    gameId,
    resolved.stage.id,
    `# 场景事件\n${actorName}传送离开了${sourceName}。`,
    { eventKind: "teleport_leave", targetStageId: target.id },
    trace,
  );
  await appendStageMemory(
    executor,
    gameId,
    target.id,
    `# 场景事件\n${actorName}传送抵达了${targetName}。`,
    { eventKind: "teleport_enter", targetStageId: resolved.stage.id },
    trace,
  );
  return `# 行动结果\n你从${sourceName}传送到了${targetName}。`;
}
