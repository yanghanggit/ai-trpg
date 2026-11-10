import type { TraceContext } from "../../debug/trace";
import type { ToolDefinition } from "../../llm/types";
import type { AddressLookup } from "../addressing";
import { applyStaticItemAction, hasAffixes, type StaticItemActionResult } from "../affixes";
import { GameError } from "../errors";
import { assertNotSelf, resolveEquippedItems } from "../lookup";
import type { ActorWithStageRow, Executor } from "../persistence/rows";
import type { ResolvedStrike } from "../settle/types";
import type { StrikeAction } from "../types";

/**
 * 武器动作：动作本身不带物品参数，武器隐式来自 `weapon` 槽。
 *
 * 这个工具只在武器穿戴中、且那把武器声明了 `affixes.strike` 时才会被装配进工具列表，
 * 所以模型看到它时就已经有武器可用；结算端仍要独立复核一次。
 */
export function buildStrikeTool(targetActorHandles: readonly string[]): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "strike",
      description:
        "把一次挥击加入计划：用 weapon 槽里装备的武器攻击同场景的一个角色；不判定命中与闪避，伤害由静态词缀直接结算。",
      parameters: {
        type: "object",
        properties: {
          targetActorHandle: {
            type: "string",
            description: "要攻击的同场景角色的引用（名字 或 #编号）；尸体也可以（伤害结算会空转）",
            ...(targetActorHandles.length > 0 ? { enum: [...targetActorHandles] } : {}),
          },
        },
        required: ["targetActorHandle"],
      },
    },
  };
}

export function parseStrike(args: Record<string, unknown>): StrikeAction {
  const targetActorHandle =
    typeof args.targetActorHandle === "string" ? args.targetActorHandle.trim() : "";
  if (targetActorHandle.length === 0) {
    throw new GameError("invalid_action", "strike 需要非空 targetActorHandle");
  }
  return { kind: "strike", targetActorHandle };
}

/**
 * 目标不要求存活：尸体也能被攻击，伤害结算会在 `isAlive` 处空转；
 * 唯一的存活要求是行动者自己。
 *
 * 武器只来自 `weapon` 槽，而且必须声明 `affixes.strike`；没有就不成立。
 */
export async function resolveStrike(
  executor: Executor,
  stage: ResolvedStrike["stage"],
  actorRow: ActorWithStageRow,
  action: StrikeAction,
  target: ResolvedStrike["target"],
): Promise<ResolvedStrike> {
  assertNotSelf(target, actorRow.actor.id);
  const weaponName = actorRow.actor.equipment.weapon;
  const item = (await resolveEquippedItems(executor, actorRow.actor)).find(
    (row) => row.name === weaponName && row.actions.includes("strike"),
  );
  if (!item) {
    throw new GameError(
      "invalid_action",
      weaponName === undefined
        ? "没有装备武器，无法挥击"
        : `weapon 槽的武器没有提供 strike: ${weaponName}`,
    );
  }
  if (!hasAffixes(item, "strike")) {
    throw new GameError("invalid_action", `weapon 槽的武器没有挥击词缀: ${item.name}`);
  }
  return { kind: "strike", action, stage, target, item };
}

/** 应用 strike：静态词缀结算；agent 词缀随后由增量阶段补。 */
export async function applyStrike(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedStrike,
  now: Date,
  address: AddressLookup,
  trace?: TraceContext,
): Promise<StaticItemActionResult> {
  return applyStaticItemAction({
    executor,
    gameId,
    actorRow,
    stage: resolved.stage,
    item: resolved.item,
    trigger: "strike",
    action: "strike",
    target: resolved.target,
    now,
    address,
    ...(trace ? { trace } : {}),
  });
}
