import type { TraceContext } from "../../debug/trace";
import type { ToolDefinition } from "../../llm/types";
import { isHandleRef, mentionOf } from "../addressing";
import { appendPublicMessage, bumpGameVersion } from "../apply/messages";
import { findStageByNameInWorld } from "../apply/queries";
import type { ActorWithStageRow, Executor, ResolvedTeleport, WorldRow } from "../apply/types";
import { GameError } from "../errors";
import { renderAction, renderEnvironmentChange, withAppearances } from "../observation-text";
import { appendCustomStageObservation, appendStageMemory } from "../observations";
import { moveActorToStage } from "../persistence/actors";
import { recordStageVisit } from "../persistence/visits";
import type { TeleportAction } from "../types";

export function buildTeleportTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "teleport",
      description:
        "传送到一个场景；写它的真名（不能用 #编号）。一次跳跃，不沿路径移动，也不产生中间场景的观察。",
      parameters: {
        type: "object",
        properties: {
          targetStageName: {
            type: "string",
            description: "目标场景的真名；服务端按名字解析场景",
          },
        },
        required: ["targetStageName"],
      },
    },
  };
}

/**
 * 传送只需要真名能对应到一个场景：不查知识账，也不要求去过。
 *
 * 只做输入判定：`#序号` 不是名字；目标必须存在、不是当前场景、两端都未禁传。
 * “知道真名”不是权限——说得出名字就能去，提示词里的候选列表只是一份省事清单。
 */
export function parseTeleport(args: Record<string, unknown>): TeleportAction {
  const targetStageName =
    typeof args.targetStageName === "string" ? args.targetStageName.trim() : "";
  if (targetStageName.length === 0) {
    throw new GameError("invalid_action", "teleport 需要非空 targetStageName");
  }
  const target = targetStageName;
  if (isHandleRef(target)) {
    throw new GameError("invalid_action", "teleport 需要目标场景的真名，不能用 #编号");
  }
  return { kind: "teleport", targetStageName: target };
}

export async function resolveTeleport(
  executor: Executor,
  world: WorldRow,
  stage: ResolvedTeleport["stage"],
  action: TeleportAction,
): Promise<ResolvedTeleport> {
  // 只认真名：编号与 id 都不是「知道这个地方」的证据。
  const targetStage = await findStageByNameInWorld(executor, world.id, action.targetStageName);
  if (!targetStage) {
    throw new GameError("invalid_action", `目标场景不存在: ${action.targetStageName}`);
  }
  if (targetStage.id === stage.id) {
    throw new GameError("invalid_action", "不能传送到当前场景");
  }
  if (stage.teleportBlocked) {
    throw new GameError("invalid_action", `当前场景禁止传送: ${stage.name}`);
  }
  if (targetStage.teleportBlocked) {
    throw new GameError("invalid_action", `目标场景禁止传送: ${targetStage.name}`);
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
  const actorName = actorRow.actor.name;
  const sourceName = resolved.stage.name;
  const targetName = target.name;

  // 离开与到达是瞬时事实：源场景看到消失，目标场景看到出现。
  await appendCustomStageObservation(
    executor,
    gameId,
    resolved.stage.id,
    actorRow.actor.id,
    (_observerId, address) =>
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
    (_observerId, address) =>
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
