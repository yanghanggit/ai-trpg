import { allowedActionKinds, assertActionAllowed } from "../actions";
import { resolveBrawl } from "../actions/brawl";
import { resolveCall } from "../actions/call";
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
import { signatureNamesFor } from "../persistence/signature-names";
import { assertNoSystemReference } from "../text-guard";
import type { ActorPlan } from "../types";
import { findSignatureByHandleInWorld, resolveEquippedItems, resolveVisibleActor } from "./queries";
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
  // actor-facing 目标只走签名或观察者当前名字；裸名字、id、未命名的 @名字 都不命中。
  const visibleTarget = (ref: string) =>
    resolveVisibleActor(executor, {
      gameId: world.gameId,
      observerId: actorRow.actor.id,
      stageId: stage.id,
      ref,
    });
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
        resolved.push(
          resolveSay(
            stage,
            actorRow.actor.id,
            action,
            await visibleTarget(action.targetActorHandle),
          ),
        );
        break;
      case "whisper":
        resolved.push(
          resolveWhisper(
            stage,
            actorRow.actor.id,
            action,
            await visibleTarget(action.targetActorHandle),
          ),
        );
        break;
      case "announce":
        assertNoSystemReference(action.message);
        resolved.push({ kind: "announce", action, stage });
        break;
      case "call":
        resolved.push(await resolveCall(executor, world, stage, actorRow.actor.id, action));
        break;
      case "move": {
        const move = await resolveMove(executor, world, stage, action);
        resolved.push(move);
        stage = move.targetStage;
        break;
      }
      case "teleport": {
        const teleport = await resolveTeleport(executor, world, stage, action);
        resolved.push(teleport);
        stage = teleport.targetStage;
        break;
      }
      case "wait":
        resolved.push(resolveWait(stage, action));
        break;
      case "strike":
        resolved.push(
          await resolveStrike(
            executor,
            stage,
            actorRow,
            action,
            await visibleTarget(action.targetActorHandle),
          ),
        );
        break;
      case "brawl":
        resolved.push(
          await resolveBrawl(
            stage,
            actorRow,
            action,
            await visibleTarget(action.targetActorHandle),
          ),
        );
        break;
      case "steal":
        resolved.push(
          await resolveSteal(
            executor,
            stage,
            actorRow.actor.id,
            action,
            await visibleTarget(action.targetActorHandle),
          ),
        );
        break;
      case "give":
        resolved.push(
          await resolveGive(
            executor,
            stage,
            actorRow.actor.id,
            action,
            await visibleTarget(action.targetActorHandle),
          ),
        );
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
      case "use": {
        const target = action.targetActorHandle
          ? await visibleTarget(action.targetActorHandle)
          : undefined;
        resolved.push(await resolveUse(executor, stage, actorRow, action, target));
        break;
      }
      default:
        throw new GameError("invalid_action", `未知动作: ${String(action)}`);
    }
  }

  // 名字更新不设条数上限：每个编号都必须是世界内已存在的签名，天然被世界规模约束；
  // 同一个编号在一份计划里重复出现时，后一次覆盖前一次。
  const bindings = new Map(
    (plan.identities ?? []).map((binding) => [binding.handle, binding] as const),
  );
  const existingNames =
    bindings.size === 0
      ? new Map<string, string>()
      : await signatureNamesFor(executor, world.gameId, actorRow.actor.id);
  const identities: ResolvedIdentity[] = [];
  for (const binding of bindings.values()) {
    const view = await findSignatureByHandleInWorld(executor, world.id, binding.handle);
    if (!view) {
      throw new GameError("invalid_action", `世界内没有这个编号: ${binding.handle}`);
    }
    if (view.actor.id === actorRow.actor.id) {
      throw new GameError("invalid_action", "不能给自己起名");
    }
    // 名字属于回合开始时的认知场景，不受本回合 move / teleport 改写；
    // 已经绑定的签名可以从记忆里更新，即使它不在场。
    if (view.actor.stageId !== actorRow.stage.id && !existingNames.has(view.signature.id)) {
      throw new GameError("invalid_action", `只能给当前场景内的角色起名: ${binding.handle}`);
    }
    identities.push({
      handle: binding.handle,
      name: binding.name,
      actorId: view.actor.id,
      signatureId: view.signature.id,
    });
  }

  return { actions: resolved, identities, routes: plan.routes ?? [] };
}
