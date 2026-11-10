import type { TraceContext } from "../../debug/trace";
import type { AddressLookup } from "../addressing";
import type { Stats } from "../attributes";
import { applyHit } from "../combat/hit";
import { GameError } from "../errors";
import { appendStageMemory } from "../observations";
import type { ActorRow, ActorWithStageRow, Executor, StageRow } from "../persistence/rows";
import type { AffixTriggers } from "../types";
import type { AffixTrigger } from "./model";
import { type StaticSettlement, settleStaticAffixes } from "./static";
import type { StaticOutcome } from "./types";
import { appendWitnessEvent, type WitnessTarget } from "./witness";

export type StaticItemActionInput = {
  executor: Executor;
  gameId: string;
  actorRow: ActorWithStageRow;
  stage: StageRow;
  item: { name: string; stats: Stats; affixes: AffixTriggers };
  trigger: AffixTrigger;
  action: "strike" | "cleave" | "use";
  target?: ActorRow;
  targetAnchor?: string;
  now: Date;
  address?: AddressLookup;
  trace?: TraceContext;
};

export type StaticItemActionResult = {
  feedback: string;
  settlement: StaticSettlement;
  outcome: StaticOutcome;
};

/**
 * 静态动作结算：一次命中（strike 恒出，use 有 damage op 才出）+ 逐条见证。
 *
 * 返回的 `feedback` 会并进行动反馈；见证的公共流、stage memory 与观察由
 * `appendWitnessEvent` 落账，出手者不会再从观察通道收到一次。
 */
export async function applyStaticItemAction(
  input: StaticItemActionInput,
): Promise<StaticItemActionResult> {
  const { executor, gameId, actorRow, stage, item, trigger, action, target, targetAnchor } = input;
  const settlement = await settleStaticAffixes({
    executor,
    actorRow,
    item,
    trigger,
    ...(target ? { target } : {}),
  });
  const lines: string[] = [];
  let outcome: StaticOutcome = { dealtDamage: 0, targetDied: false };

  // strike 与 cleave 恒出命中：单体挥击与横扫都是“打了”，use 只在有 damage op 时出命中。
  if (action === "strike" || action === "cleave" || settlement.hasDamageOps) {
    if (!target) {
      throw new GameError("invalid_action", "伤害词缀需要角色目标");
    }
    const hit = await applyHit({
      executor,
      gameId,
      actorRow,
      stage,
      target,
      damage: settlement.damage,
      action,
      itemName: item.name,
      now: input.now,
      ...(input.address ? { address: input.address } : {}),
      ...(input.trace ? { trace: input.trace } : {}),
    });
    lines.push(hit.feedback);
    outcome = { dealtDamage: hit.dealtDamage, targetDied: hit.targetDied };
    if (settlement.damageLines.length > 0) {
      await appendStageMemory(
        executor,
        gameId,
        stage.id,
        `# 场景事件（词缀分解，减防前）\n${settlement.damageLines.map((line) => `- ${line}`).join("\n")}`,
        { eventKind: action, targetActorId: target.id },
        input.trace,
      );
    }
  }

  const witnessTarget: WitnessTarget | undefined = target
    ? { kind: "actor", actorId: target.id }
    : targetAnchor
      ? { kind: "anchor", label: targetAnchor }
      : undefined;
  for (const witness of settlement.witnesses) {
    const feedback = await appendWitnessEvent({
      executor,
      gameId,
      action,
      stage,
      source: actorRow.actor,
      itemName: item.name,
      event: {
        affixName: witness.affixName,
        sourceActorId: actorRow.actor.id,
        ...(witnessTarget ? { target: witnessTarget } : {}),
        template: witness.template,
        visibility: witness.visibility,
      },
      ...(input.address ? { address: input.address } : {}),
      ...(input.trace ? { trace: input.trace } : {}),
    });
    lines.push(`# 行动结果\n${feedback}`);
  }

  return { feedback: lines.join("\n\n"), settlement, outcome };
}
