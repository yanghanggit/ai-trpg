import { allowedActionKinds, assertActionAllowed } from "../actions";
import { resolveBrawl } from "../actions/brawl";
import { resolveEquip } from "../actions/equip";
import { resolveGive } from "../actions/give";
import { resolveMove } from "../actions/move";
import { resolvePickup } from "../actions/pickup";
import { resolveSay } from "../actions/say";
import { resolveSteal } from "../actions/steal";
import { resolveStrike } from "../actions/strike";
import { resolveTeleport } from "../actions/teleport";
import { resolveUnequip } from "../actions/unequip";
import { resolveUse } from "../actions/use";
import { resolveWait } from "../actions/wait";
import { resolveWhisper } from "../actions/whisper";
import { GameError } from "../errors";
import { assertNoSystemReference } from "../text-guard";
import type { ActorPlan } from "../types";
import { findActorViewByHandleInWorld, resolveEquippedItems } from "./queries";
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
  // 物品提供的动作与角色固有动作同权：穿戴中的物品把自己的动作借给角色。
  // 装备变更在本轮解析期不回灌，所以「本回合卸下/换上武器」要到下一回合才影响可用动作。
  const granted = (await resolveEquippedItems(executor, actorRow.actor)).flatMap(
    (row) => row.actions,
  );
  const allowed = allowedActionKinds(actorRow.actor.actions, granted);

  for (const action of plan.actions) {
    assertActionAllowed(allowed, action.kind, actorRow.actor.name);
    switch (action.kind) {
      case "say":
        resolved.push(await resolveSay(executor, stage, actorRow.actor.id, action));
        break;
      case "whisper":
        resolved.push(await resolveWhisper(executor, stage, actorRow.actor.id, action));
        break;
      case "announce":
        assertNoSystemReference(action.message);
        resolved.push({ kind: "announce", action, stage });
        break;
      case "move": {
        const move = await resolveMove(executor, world, stage, action);
        resolved.push(move);
        stage = move.targetStage;
        break;
      }
      case "teleport": {
        const teleport = await resolveTeleport(executor, world, stage, actorRow.actor.id, action);
        resolved.push(teleport);
        stage = teleport.targetStage;
        break;
      }
      case "wait":
        resolved.push(resolveWait(stage, action));
        break;
      case "strike":
        resolved.push(await resolveStrike(executor, stage, actorRow, action));
        break;
      case "brawl":
        resolved.push(await resolveBrawl(executor, stage, actorRow, action));
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

  // 认知更新不设条数上限：每个编号都必须是世界内已存在的形象，天然被世界规模约束；
  // 同一个编号在一份计划里重复出现时，后一次覆盖前一次，避免重复写记忆。
  const bindings = new Map(
    (plan.identities ?? []).map((binding) => [binding.handle, binding] as const),
  );
  const identities: ResolvedIdentity[] = [];
  for (const binding of bindings.values()) {
    const view = await findActorViewByHandleInWorld(executor, world.id, binding.handle);
    if (!view) {
      throw new GameError("invalid_action", `世界内没有这个编号: ${binding.handle}`);
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
