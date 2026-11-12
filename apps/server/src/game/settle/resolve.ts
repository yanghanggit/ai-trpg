import { allowedActionKinds, assertActionAllowed } from "../actions";
import { actionSpec, type ResolveContext } from "../actions/registry";
import { GameError } from "../errors";
import type { ActorPlan } from "../kernel/types";
import { findSignatureByHandleInWorld, resolveActionSources, resolveVisibleActor } from "../lookup";
import type { ActorWithStageRow, Executor, StageRow, WorldRow } from "../persistence/rows";
import { signatureNamesFor } from "../persistence/signature-names";
import type { ResolvedAction, ResolvedIdentity, ResolvedPlan } from "./types";

/**
 * 顺序校验计划里的动作，并模拟移动后的舞台，不写数据库。
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
  // actor-facing 目标只走签名或观察者当前称呼；id 与未命名的名字都不命中。
  const visibleTarget = (ref: string) =>
    resolveVisibleActor(executor, {
      gameId: world.gameId,
      observerId: actorRow.actor.id,
      stageId: stage.id,
      ref,
    });
  // 归属与装备在本轮解析期不回灌：本回合的卸下/换上要到下一回合才影响可用动作。
  const sources = await resolveActionSources(executor, actorRow.actor);
  const allowed = allowedActionKinds(actorRow.actor.actions, sources.slot, sources.held);

  for (const action of plan.actions) {
    const spec = actionSpec(action.kind);
    assertActionAllowed(
      allowed,
      action.kind,
      actorRow.actor.name,
      spec.blockedReason?.(actorRow.actor.name),
    );
    const context: ResolveContext = { executor, world, actorRow, stage, visible: visibleTarget };
    const resolvedAction = await spec.resolve(context, action);
    resolved.push(resolvedAction);
    // 带目标舞台的解析结果改写后续动作的当前舞台：位移动作就是这样生效的。
    const targetStage = (resolvedAction as { targetStage?: StageRow }).targetStage;
    if (targetStage) {
      stage = targetStage;
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
    // 名字属于回合开始时的认知舞台，不受本回合 move / teleport 改写；
    // 已经绑定的签名可以从记忆里更新，即使它不在场。
    const alreadyNamed = existingNames.has(view.signature.id);
    if (view.actor.concealed && !alreadyNamed) {
      throw new GameError("invalid_action", `当前舞台内找不到这个编号: ${binding.handle}`);
    }
    if (view.actor.stageId !== actorRow.stage.id && !alreadyNamed) {
      throw new GameError("invalid_action", `只能给当前舞台内的角色起名: ${binding.handle}`);
    }
    identities.push({
      handle: binding.handle,
      name: binding.name,
      actorId: view.actor.id,
      signatureId: view.signature.id,
    });
  }

  return {
    actions: resolved,
    identities,
    routes: plan.routes ?? [],
    routeFailures: plan.routeFailures ?? [],
  };
}
