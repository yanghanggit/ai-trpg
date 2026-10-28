import { assertActionAllowed } from "../actions";
import { resolveAttack } from "../actions/attack";
import { resolveEquip } from "../actions/equip";
import { resolveGive } from "../actions/give";
import { resolveMove } from "../actions/move";
import { resolvePickup } from "../actions/pickup";
import { resolveSay } from "../actions/say";
import { resolveSteal } from "../actions/steal";
import { resolveUnequip } from "../actions/unequip";
import { resolveUse } from "../actions/use";
import { resolveWait } from "../actions/wait";
import { resolveWhisper } from "../actions/whisper";
import { MAX_IDENTITIES_PER_TURN } from "../constants";
import { GameError } from "../errors";
import type { ActorPlan } from "../types";
import { findActorViewByHandleInWorld } from "./queries";
import type {
  ActorWithStageRow,
  Executor,
  ResolvedAction,
  ResolvedIdentity,
  ResolvedPlan,
  StageRow,
  WorldRow,
} from "./types";

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
): Promise<ResolvedPlan> {
  let stage: StageRow = actorRow.stage;
  const resolved: ResolvedAction[] = [];

  for (const action of plan.actions) {
    assertActionAllowed(actorRow.actor.actions, action.kind, actorRow.actor.name);
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
        resolved.push(await resolveAttack(executor, stage, actorRow, action));
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
      case "equip":
        resolved.push(await resolveEquip(executor, actorRow, action));
        break;
      case "unequip":
        resolved.push(resolveUnequip(actorRow, action));
        break;
      case "use":
        resolved.push(await resolveUse(executor, stage, actorRow, action));
        break;
      default:
        throw new GameError("invalid_action", `未知动作: ${String(action)}`);
    }
  }

  const bindings = plan.identities ?? [];
  if (bindings.length > MAX_IDENTITIES_PER_TURN) {
    throw new GameError(
      "invalid_action",
      `本轮最多记 ${MAX_IDENTITIES_PER_TURN} 个名字，实际提交 ${bindings.length} 个`,
    );
  }
  const identities: ResolvedIdentity[] = [];
  for (const binding of bindings) {
    const view = await findActorViewByHandleInWorld(executor, world.id, binding.handle);
    if (!view) {
      throw new GameError("invalid_action", `世界内没有这个指代: ${binding.handle}`);
    }
    identities.push({
      handle: binding.handle,
      name: binding.name,
      actorId: view.actor.id,
      presentationId: view.presentation.id,
      stageId: view.actor.stageId,
    });
  }

  return { actions: resolved, identities };
}
