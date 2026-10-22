import { GameError } from "../errors";
import { intentClass, intentClassLabel } from "../plan";
import type { ActorPlan, Skill, SkillIntent } from "../types";
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
  ResolvedSkill,
  StageRow,
  WorldRow,
} from "./types";

function assertNever(value: never): never {
  throw new Error(`未处理的 intent: ${String(value)}`);
}

/** 校验 plan 的类别互斥；同类别只能有一个 intent。 */
export function validatePlanShape(plan: ActorPlan): void {
  if (plan.intents.length === 0) {
    throw new GameError("invalid_action", "计划中没有行动");
  }
  if (plan.intents.length > 2) {
    throw new GameError("invalid_action", "计划最多包含一个沟通行动和一个行动类行动");
  }
  const classes = new Set<ReturnType<typeof intentClass>>();
  for (const intent of plan.intents) {
    const intentClassValue = intentClass(intent);
    if (classes.has(intentClassValue)) {
      throw new GameError("invalid_action", `本轮已有${intentClassLabel(intentClassValue)}类行动`);
    }
    classes.add(intentClassValue);
  }
}

async function resolveSkill(
  executor: Executor,
  stage: StageRow,
  actorRow: ActorWithStageRow,
  intent: SkillIntent,
): Promise<ResolvedSkill> {
  const skills = actorRow.actor.skills as unknown as Skill[];
  const skill = skills.find((candidate) => candidate.key === intent.skill.key);
  if (!skill) {
    throw new GameError("invalid_action", `actor 未掌握技能: ${intent.skill.key}`);
  }
  if (skill.resolution !== "computed") {
    throw new GameError("invalid_action", `技能需要 GM 判定: ${skill.name}`);
  }

  const base = {
    kind: "skill" as const,
    intent: { ...intent, skill },
    skill,
    stage,
    items: [] as ResolvedSkill["items"],
  };

  switch (intent.purpose.kind) {
    case "damage": {
      const items = await resolveActorItems(executor, actorRow.actor.id, intent.itemNames);
      if (skill.itemPolicy === "required" && items.length === 0) {
        throw new GameError("invalid_action", `技能需要至少一个道具: ${skill.name}`);
      }
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
    case "narrative":
      throw new GameError("invalid_action", "narrative 技能尚未实现");
    default:
      return assertNever(intent.purpose);
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
      case "skill":
        resolved.push(await resolveSkill(executor, stage, actorRow, intent));
        break;
      default:
        assertNever(intent);
    }
  }

  return resolved;
}
