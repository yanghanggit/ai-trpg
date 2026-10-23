import { GameError } from "../errors";
import { interactBranch } from "../interact";
import { intentSlot, intentSlotLabel } from "../plan";
import type { ActorPlan, InteractIntent } from "../types";
import {
  resolveActorItem,
  resolveActorItems,
  resolveActorTarget,
  resolveCommunicationTarget,
  resolveDamageTarget,
  resolveMovementTarget,
  resolveStageItem,
} from "./queries";
import type {
  ActorWithStageRow,
  Executor,
  ResolvedIntent,
  ResolvedInteraction,
  StageRow,
  WorldRow,
} from "./types";

function assertNever(value: never): never {
  throw new Error(`未处理的 intent: ${String(value)}`);
}

/** 校验 plan 的槽位互斥：沟通一槽，移动/交互共享行动槽；同槽位只能有一个 intent。 */
export function validatePlanShape(plan: ActorPlan): void {
  if (plan.intents.length === 0) {
    throw new GameError("invalid_action", "计划中没有行动");
  }
  if (plan.intents.length > 2) {
    throw new GameError("invalid_action", "计划最多包含一个沟通行动和一个行动类行动");
  }
  const slots = new Set<ReturnType<typeof intentSlot>>();
  for (const intent of plan.intents) {
    const slot = intentSlot(intent);
    if (slots.has(slot)) {
      throw new GameError("invalid_action", `本轮已有${intentSlotLabel(slot)}行动`);
    }
    slots.add(slot);
  }
}

/** 校验一次交互：分支可能由 GM 判定，并把目的解析成具体对象与道具。 */
async function resolveInteraction(
  executor: Executor,
  stage: StageRow,
  actorRow: ActorWithStageRow,
  intent: InteractIntent,
): Promise<ResolvedInteraction> {
  const branch = interactBranch(intent.purpose.kind);
  if (branch.resolution !== "computed") {
    throw new GameError("invalid_action", `交互分支需要 GM 判定: ${intent.purpose.kind}`);
  }

  const base = {
    kind: "interact" as const,
    intent,
    branch,
    stage,
    items: [] as ResolvedInteraction["items"],
  };

  switch (intent.purpose.kind) {
    case "damage": {
      const items = await resolveActorItems(executor, actorRow.actor.id, intent.itemNames);
      const target = await resolveDamageTarget(
        executor,
        stage.id,
        actorRow.actor.id,
        intent.purpose.targetActorName,
      );
      return { ...base, items, target };
    }
    case "steal": {
      const target = await resolveActorTarget(
        executor,
        stage.id,
        actorRow.actor.id,
        intent.purpose.targetActorName,
        { allowSelf: false, allowDead: true },
      );
      const transferItem = await resolveActorItem(executor, target.id, intent.purpose.itemName);
      return { ...base, target, transferItem };
    }
    case "give": {
      const target = await resolveActorTarget(
        executor,
        stage.id,
        actorRow.actor.id,
        intent.purpose.targetActorName,
        { allowSelf: false, allowDead: false },
      );
      const transferItem = await resolveActorItem(
        executor,
        actorRow.actor.id,
        intent.purpose.itemName,
      );
      return { ...base, target, transferItem };
    }
    case "pickup": {
      const stageItem = await resolveStageItem(executor, stage.id, intent.purpose.itemName);
      return { ...base, stageItem };
    }
    case "use": {
      const transferItem = await resolveActorItem(
        executor,
        actorRow.actor.id,
        intent.purpose.itemName,
      );
      if (intent.purpose.targetStageName !== undefined) {
        if (intent.purpose.targetStageName !== stage.name) {
          throw new GameError("invalid_action", "只能对当前所在场景使用道具");
        }
        return { ...base, targetStage: stage, transferItem };
      }
      const targetActorName = intent.purpose.targetActorName;
      if (!targetActorName) {
        throw new GameError("invalid_action", "use 目的缺少目标");
      }
      const target = await resolveActorTarget(
        executor,
        stage.id,
        actorRow.actor.id,
        targetActorName,
        { allowSelf: true, allowDead: false },
      );
      return { ...base, target, transferItem };
    }
  }
}

/** 顺序校验 intent，并模拟移动后的场景，不写数据库。 */
export async function resolvePlan(
  executor: Executor,
  world: WorldRow,
  actorRow: ActorWithStageRow,
  plan: ActorPlan,
): Promise<ResolvedIntent[]> {
  validatePlanShape(plan);
  let stage = actorRow.stage;
  const resolved: ResolvedIntent[] = [];

  for (const intent of plan.intents) {
    switch (intent.kind) {
      case "communication": {
        const targetActor = await resolveCommunicationTarget(
          executor,
          stage.id,
          actorRow.actor.id,
          intent,
        );
        resolved.push({
          kind: "communication",
          intent,
          stage,
          ...(targetActor ? { targetActor } : {}),
        });
        break;
      }
      case "movement": {
        const targetStage = await resolveMovementTarget(executor, world, stage, intent);
        resolved.push({
          kind: "movement",
          intent,
          stage,
          ...(targetStage ? { targetStage } : {}),
        });
        if (targetStage) {
          stage = targetStage;
        }
        break;
      }
      case "interact":
        resolved.push(await resolveInteraction(executor, stage, actorRow, intent));
        break;
      default:
        assertNever(intent);
    }
  }

  return resolved;
}
