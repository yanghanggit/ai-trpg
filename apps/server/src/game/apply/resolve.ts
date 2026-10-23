import { assertActionAllowed } from "../actions";
import { resolveAttack } from "../actions/attack";
import { resolveGive } from "../actions/give";
import { resolveMove } from "../actions/move";
import { resolvePickup } from "../actions/pickup";
import { resolveSay } from "../actions/say";
import { resolveSteal } from "../actions/steal";
import { resolveUse } from "../actions/use";
import { resolveWait } from "../actions/wait";
import { resolveWhisper } from "../actions/whisper";
import { GameError } from "../errors";
import type { ActorCapability, ActorPlan } from "../types";
import type { ActorWithStageRow, Executor, ResolvedAction, StageRow, WorldRow } from "./types";

/**
 * 顺序校验计划里的动作，并模拟移动后的场景，不写数据库。
 *
 * 任何一条校验失败都会抛出 GameError，让整份计划不落地。
 */
export async function resolvePlan(
  executor: Executor,
  world: WorldRow,
  actorRow: ActorWithStageRow,
  plan: ActorPlan,
): Promise<ResolvedAction[]> {
  let stage: StageRow = actorRow.stage;
  const resolved: ResolvedAction[] = [];

  const actorActions = actorRow.actor.actions as unknown as ActorCapability[];
  for (const action of plan.actions) {
    assertActionAllowed(actorActions, action.kind, actorRow.actor.name);
    switch (action.kind) {
      case "say":
        resolved.push(await resolveSay(executor, stage, actorRow.actor.id, action));
        break;
      case "whisper":
        resolved.push(await resolveWhisper(executor, stage, actorRow.actor.id, action));
        break;
      case "announce":
        resolved.push({ kind: "announce", action, stage });
        break;
      case "move": {
        const move = await resolveMove(executor, world, stage, action);
        resolved.push(move);
        stage = move.targetStage;
        break;
      }
      case "wait":
        resolved.push(resolveWait(stage, action));
        break;
      case "attack":
        resolved.push(await resolveAttack(executor, stage, actorRow.actor.id, action));
        break;
      case "steal":
        resolved.push(await resolveSteal(executor, stage, actorRow.actor.id, action));
        break;
      case "give":
        resolved.push(await resolveGive(executor, stage, actorRow.actor.id, action));
        break;
      case "pickup":
        resolved.push(await resolvePickup(executor, stage, action));
        break;
      case "use":
        resolved.push(await resolveUse(executor, stage, actorRow.actor.id, action));
        break;
      default:
        throw new GameError("invalid_action", `未知动作: ${String(action)}`);
    }
  }

  return resolved;
}
