import type { TraceContext } from "../../../debug/trace";
import { applyHit } from "../../combat/hit";
import { GameError } from "../../errors";
import type { AddressLookup } from "../../kernel/addressing";
import { type AffixTrigger, triggerAlwaysHits } from "../../kernel/affixes";
import type { Stats } from "../../kernel/attributes";
import type { AffixTriggers } from "../../kernel/types";
import { appendStageMemory } from "../../observations";
import type { ActorRow, ActorWithStageRow, Executor, StageRow } from "../../persistence/rows";
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
  action: AffixTrigger;
  target?: ActorRow;
  targetAnchor?: string;
  now: Date;
  address?: AddressLookup;
  trace?: TraceContext;
};

export type StaticItemActionResult = {
  feedback: string;
  settlement: StaticSettlement;
  /** 只有真的出了命中才有结果；没有角色目标的动作不带。 */
  outcome?: StaticOutcome;
};

/**
 * 静态动作结算：一次命中（按触发表决定是否恒出）+ 逐条见证。
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
  let outcome: StaticOutcome | undefined;

  // 有的触发没有伤害 op 也算“打了”；其余触发只在声明了 damage op 时出命中。
  if (triggerAlwaysHits(trigger) || settlement.hasDamageOps) {
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
    outcome = { actorId: target.id, dealtDamage: hit.dealtDamage, targetDied: hit.targetDied };
    if (settlement.damageLines.length > 0) {
      await appendStageMemory(
        executor,
        gameId,
        stage.id,
        `# 舞台事件（词缀分解，减防前）\n${settlement.damageLines.map((line) => `- ${line}`).join("\n")}`,
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
    lines.push(feedback);
  }

  // 同一行动的句子并排在同一块里，标题由落账层补。
  return { feedback: lines.join("\n"), settlement, outcome };
}
