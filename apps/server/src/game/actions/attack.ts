import { eq } from "drizzle-orm";
import { actors } from "../../db/schema";
import type { ToolDefinition } from "../../llm/types";
import { appendPublicMessage, bumpGameVersion, itemListText } from "../apply/messages";
import { assertAlive, assertNotSelf, findActorInStage, resolveActorItems } from "../apply/queries";
import type { ActorWithStageRow, Executor, ResolvedAttack } from "../apply/types";
import { sumAttribute } from "../attributes";
import { GameError } from "../errors";
import { appendAttackObservations, appendStageEvent } from "../observations";
import type { AttackAction } from "../types";

/** 构造 attack 工具：攻击同场景一个角色，可搭配自己持有的武器。 */
export function buildAttackTool(
  targetActorNames: readonly string[],
  itemNames: readonly string[],
): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "attack",
      description:
        "把一次攻击加入计划：对同场景的一个角色造成伤害；可以搭配自己持有的武器道具，也可以空手。先用 look_stage 确认目标是否在同场景。",
      parameters: {
        type: "object",
        properties: {
          targetActorName: {
            type: "string",
            description: "要攻击的同场景角色",
            ...(targetActorNames.length > 0 ? { enum: [...targetActorNames] } : {}),
          },
          itemNames: {
            type: "array",
            items: {
              type: "string",
              ...(itemNames.length > 0 ? { enum: [...itemNames] } : {}),
            },
            description: "本次攻击搭配的自身武器道具；可以为空",
          },
        },
        required: ["targetActorName"],
      },
    },
  };
}

/** 把 attack 工具参数转成动作；只检查形状。 */
export function parseAttack(args: Record<string, unknown>): AttackAction {
  const targetActorName =
    typeof args.targetActorName === "string" ? args.targetActorName.trim() : "";
  if (targetActorName.length === 0) {
    throw new GameError("invalid_action", "attack 需要非空 targetActorName");
  }
  const rawItemNames = Array.isArray(args.itemNames) ? args.itemNames : [];
  const itemNames = [
    ...new Set(
      rawItemNames
        .filter((itemName): itemName is string => typeof itemName === "string")
        .map((itemName) => itemName.trim())
        .filter((itemName) => itemName.length > 0),
    ),
  ];
  return { kind: "attack", targetActorName, itemNames };
}

/** 校验 attack：目标存活且不是自己，道具必须都是自己持有的武器。 */
export async function resolveAttack(
  executor: Executor,
  stage: ResolvedAttack["stage"],
  actorId: string,
  action: AttackAction,
): Promise<ResolvedAttack> {
  const target = await findActorInStage(executor, stage.id, action.targetActorName);
  assertNotSelf(target, actorId);
  assertAlive(target);
  const items = await resolveActorItems(executor, actorId, action.itemNames);
  if (items.some((item) => item.kind !== "weapon")) {
    throw new GameError("invalid_action", "attack 只能搭配武器道具");
  }
  return { kind: "attack", action, stage, target, items };
}

/** 应用 attack：伤害 = max(0, attack + 武器 damage - 目标 defense)。 */
export async function applyAttack(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedAttack,
  now: Date,
): Promise<string> {
  const target = resolved.target;
  const weaponDamage = sumAttribute(
    resolved.items.map((item) => item.stats),
    "damage",
  );
  const damage = Math.max(0, actorRow.actor.stats.attack + weaponDamage - target.stats.defense);
  const remainingHp = Math.max(0, target.stats.hp - damage);
  const status = remainingHp <= 0 ? "dead" : "alive";

  await executor
    .update(actors)
    .set({ stats: { ...target.stats, hp: remainingHp }, status, updatedAt: now })
    .where(eq(actors.id, target.id));
  await bumpGameVersion(executor, gameId, now);

  const itemText = itemListText(resolved.items);
  const outcome =
    status === "dead"
      ? `；${target.name}倒下了。`
      : `；${target.name}剩余 HP ${remainingHp}/${target.stats.maxHp}。`;
  const content = `${actorRow.actor.name}对${target.name}使用攻击${itemText}，造成${damage}点伤害${outcome}`;
  await appendPublicMessage(executor, gameId, actorRow.actor.id, {
    kind: "attack",
    stageId: resolved.stage.id,
    targetActorId: target.id,
    visibility: "stage",
    content,
  });
  await appendAttackObservations(
    executor,
    gameId,
    resolved.stage,
    { id: actorRow.actor.id, name: actorRow.actor.name },
    { id: target.id, name: target.name, maxHp: target.stats.maxHp },
    "stage",
    resolved.items,
    damage,
    remainingHp,
    status,
  );
  await appendStageEvent(executor, gameId, resolved.stage.id, `# 场景事件\n${content}`, {
    eventKind: "attack",
    targetActorId: target.id,
  });
  return `# 行动结果\n你使用攻击${itemText}对${target.name}，造成${damage}点伤害；${status === "dead" ? `${target.name}倒下了` : `${target.name}剩余 HP ${remainingHp}/${target.stats.maxHp}`}。`;
}
