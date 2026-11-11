import type { TraceContext } from "../../debug/trace";
import type { ToolDefinition } from "../../llm/types";
import { applyStaticItemAction } from "../agents/affixes";
import { GameError } from "../errors";
import type { AddressLookup } from "../kernel/addressing";
import { hasAffixes } from "../kernel/affixes";
import type { CleaveAction } from "../kernel/types";
import { assertNotSelf, resolveEquippedItems } from "../lookup";
import type { ActorRow, ActorWithStageRow, Executor } from "../persistence/rows";
import type { ResolvedCleave } from "../settle/types";

/**
 * 武器动作：一次挥击命中多个目标，动作本身不带道具参数，武器隐式来自 `weapon` 槽。
 *
 * 与 `strike` 的分工只有目标数：`strike` 恒为单体，`cleave` 的上限由武器的
 * `maxTargets` 给出。工具形状里写 `maxItems` 只是给模型看的形状，
 * 真正的约束在 `resolveCleave` 里按武器行复核一次。
 */
export function buildCleaveTool(
  targetActorHandles: readonly string[],
  maxTargets: number,
): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "cleave",
      description: `把一次横扫加入计划：用 weapon 槽里装备的武器同时攻击同舞台的 1–${maxTargets} 个角色；不判定命中与闪避，每个目标的伤害各自由静态词缀结算一次。`,
      parameters: {
        type: "object",
        properties: {
          targets: {
            type: "array",
            items: {
              type: "string",
              description:
                "要攻击的同舞台角色的引用（名字 或 #编号）；尸体也可以（伤害结算会空转）",
              ...(targetActorHandles.length > 0 ? { enum: [...targetActorHandles] } : {}),
            },
            minItems: 1,
            maxItems: maxTargets,
            description: `这次横扫的目标，按顺序结算；最多 ${maxTargets} 个（武器决定）`,
          },
        },
        required: ["targets"],
      },
    },
  };
}

/**
 * 目标允许写成任意多条的列表；解析只做形状校验，不给数量上限。
 *
 * 上限属于武器，不属于动作语法：解析层拿不到武器，硬编码一个数字会让两处规则打架。
 */
export function parseCleave(args: Record<string, unknown>): CleaveAction {
  const raw = args.targets;
  if (!Array.isArray(raw)) {
    throw new GameError("invalid_action", "cleave 需要非空的 targets 列表");
  }
  const targetActorHandles = raw.map((value) => (typeof value === "string" ? value.trim() : ""));
  if (targetActorHandles.length === 0 || targetActorHandles.some((handle) => handle.length === 0)) {
    throw new GameError("invalid_action", "cleave 需要非空的 targets 列表");
  }
  return { kind: "cleave", targetActorHandles };
}

/**
 * 目标不要求存活：尸体也能被扫到，伤害结算会在 `isAlive` 处空转；
 * 唯一的存活要求是行动者自己。
 *
 * 武器只来自 `weapon` 槽，必须声明 `cleave`，且必须带 `maxTargets` 约束目标数。
 * `maxTargets` 之外还有两条静态约束：目标不能重复、不能包含自己。
 */
export async function resolveCleave(
  executor: Executor,
  stage: ResolvedCleave["stage"],
  actorRow: ActorWithStageRow,
  action: CleaveAction,
  targets: readonly ActorRow[],
): Promise<ResolvedCleave> {
  const weaponName = actorRow.actor.equipment.weapon;
  const item = (await resolveEquippedItems(executor, actorRow.actor)).find(
    (row) => row.name === weaponName && row.actions.includes("cleave"),
  );
  if (!item) {
    throw new GameError(
      "invalid_action",
      weaponName === undefined
        ? "没有装备武器，无法横扫"
        : `weapon 槽的武器没有提供 cleave: ${weaponName}`,
    );
  }
  // 横扫有自己的触发：同一个动作最多引用一件道具，后果全由该触发的词缀承担。
  if (!hasAffixes(item, "cleave")) {
    throw new GameError("invalid_action", `weapon 槽的武器没有横扫词缀: ${item.name}`);
  }
  if (targets.length === 0) {
    throw new GameError("invalid_action", "cleave 需要至少一个目标");
  }
  if (targets.length > item.maxTargets) {
    throw new GameError(
      "invalid_action",
      `${item.name} 一次最多横扫 ${item.maxTargets} 个目标，实际给了 ${targets.length} 个`,
    );
  }
  for (const target of targets) {
    assertNotSelf(target, actorRow.actor.id);
  }
  const unique = new Set(targets.map((target) => target.id));
  if (unique.size !== targets.length) {
    throw new GameError("invalid_action", "cleave 的目标不能重复");
  }
  return { kind: "cleave", action, stage, targets: [...targets], item };
}

/**
 * 应用 cleave：逐目标各结算一次静态词缀。
 *
 * 每个目标是一次独立的命中：伤害各自按该目标的 `block` 减伤，扣血、公共消息、
 * 伤害观察与舞台记忆都由同一条 `applyHit` 落账，因此不会出现“一次横扫只算总伤害”。
 *
 * 已知边界：agent 词缀阶段目前按「一个动作一个目标」建模（`AffixRequest` 只有一个
 * `targetActorId`），所以横扫只跑静态词缀，不追加推理端增量。要放开需要先把
 * 词缀请求扩成多目标。
 */
export async function applyCleave(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedCleave,
  now: Date,
  address: AddressLookup,
  trace?: TraceContext,
): Promise<string> {
  const lines: string[] = [];
  for (const target of resolved.targets) {
    const result = await applyStaticItemAction({
      executor,
      gameId,
      actorRow,
      stage: resolved.stage,
      item: resolved.item,
      trigger: "cleave",
      action: "cleave",
      target,
      now,
      address,
      ...(trace ? { trace } : {}),
    });
    lines.push(result.feedback);
  }
  return lines.join("\n\n");
}
