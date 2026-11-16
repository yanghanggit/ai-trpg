import type { TraceContext } from "../../../debug/trace";
import { type AddressLookup, actionRef, mentionOf } from "../../kernel/addressing";
import { damageActionText, withAppearances } from "../../kernel/observation-text";
import type { AffixTrigger, HitAction } from "../../kernel/types";
import { MEMORY_KINDS } from "../../memory/kinds";
import {
  appendCustomObservation,
  appendDamageObservations,
  appendStageMemory,
} from "../../observations";
import { damageActor, healActor } from "../../persistence/actors";
import { appendPublicMessage } from "../../persistence/game-messages";
import type { Executor, StageRow } from "../../persistence/rows";
import type { ActorSnapshot, SettlementHitResult, SettlementOutcome } from "./types";
import { appendWitnessEvent } from "./witness";

/**
 * 结算落账：把 `settle` 的产物写进账本与记忆。
 *
 * 效果**逐条**写，顺序就是数组顺序；同一目标出现多条时，后一条看到前一条写完的生命。
 * 数值换算全在 `settle`，这里只负责取引用、写消息与观察。
 */

export type ApplySettlementInput = {
  executor: Executor;
  gameId: string;
  stage: StageRow;
  address: AddressLookup;
  now: Date;
  action: HitAction;
  itemName?: string;
  /** 推理端追加的伤害沿用词缀措辞。 */
  via?: "affix";
  initiator: ActorSnapshot;
  affected?: ActorSnapshot;
  targetAnchor?: string;
  outcome: SettlementOutcome;
  trace?: TraceContext;
};

export type ApplySettlementResult = {
  feedback: string;
  hit?: SettlementHitResult;
};

/** 0 伤害也是命中，但不写「造成0点伤害」这种自相矛盾的句子。 */
function describeDamage(damage: number, via?: "affix"): string {
  if (damage === 0) {
    return via === "affix" ? "词缀没有追加伤害" : "没能造成伤害";
  }
  return via === "affix" ? `词缀追加${damage}点伤害` : `造成${damage}点伤害`;
}

async function writeDamage(input: {
  executor: Executor;
  gameId: string;
  stage: StageRow;
  attacker: ActorSnapshot;
  target: ActorSnapshot;
  damage: number;
  action: HitAction;
  itemName?: string;
  via?: "affix";
  now: Date;
  address?: AddressLookup;
  trace?: TraceContext;
}): Promise<{ feedback: string; result: SettlementHitResult }> {
  const { attacker, target, damage, action, itemName, via } = input;
  const ref = (id: string) =>
    input.address
      ? actionRef(input.address(id))
      : id === target.actorId
        ? target.name
        : attacker.name;
  const hit = await damageActor(input.executor, target.actorId, damage, input.now);
  if (hit.status === "missing") {
    throw new Error(`目标不存在: ${target.name}`);
  }
  if (hit.status === "already-dead") {
    return {
      feedback: `${ref(target.actorId)}已经倒下。`,
      result: { actorId: target.actorId, dealtDamage: 0, targetDied: false },
    };
  }

  const remainingHp = hit.remainingHp;
  const dealtDamage = hit.row.hp - remainingHp;
  const targetDied = remainingHp <= 0;
  const maxHp = hit.row.stats.maxHp;
  // 公共事件是上帝视角：句首与结局都用名字，不混入观察者相对的引用。
  const outcome =
    remainingHp <= 0
      ? `；${hit.row.name}倒下了。`
      : `；${hit.row.name}剩余 HP ${remainingHp}/${maxHp}。`;
  const actionText = damageActionText(action, itemName);
  const damageText = describeDamage(damage, via);
  const content = `${attacker.name}对${hit.row.name}${actionText}，${damageText}${outcome}`;

  await appendPublicMessage(input.executor, input.gameId, attacker.actorId, {
    kind: action,
    stageId: input.stage.id,
    targetActorId: target.actorId,
    visibility: "stage",
    content,
  });
  await appendDamageObservations(
    input.executor,
    input.gameId,
    input.stage,
    {
      action,
      attacker: { id: attacker.actorId },
      target: { id: target.actorId, maxHp },
      ...(itemName ? { itemName } : {}),
      damage,
      remainingHp,
      ...(via ? { via } : {}),
    },
    input.trace,
  );
  await appendStageMemory(
    input.executor,
    input.gameId,
    input.stage.id,
    `# 舞台事件\n${content}`,
    { eventKind: action, targetActorId: target.actorId },
    input.trace,
  );

  // 出手者只知道这一下打得多重、对方有没有倒下；剩余生命只进公共事件与受害者自己。
  const feedback = `你对${ref(target.actorId)}${actionText}，${damageText}`;
  return {
    feedback: `${feedback}${targetDied ? `；${ref(target.actorId)}倒下了` : ""}。`,
    result: { actorId: target.actorId, dealtDamage, targetDied },
  };
}

async function writeHeal(input: {
  executor: Executor;
  gameId: string;
  stage: StageRow;
  source: ActorSnapshot;
  healed: ActorSnapshot;
  amount: number;
  action: HitAction;
  now: Date;
  address?: AddressLookup;
  trace?: TraceContext;
}): Promise<string> {
  const { source, healed, amount, action } = input;
  const result = await healActor(input.executor, healed.actorId, amount, input.now);
  if (result.status === "missing") {
    throw new Error(`目标不存在: ${healed.name}`);
  }
  // 已收尾的死者拒绝治疗；满血时 healedHp 为 0，不值得写一条「恢复了 0 点」。
  if (result.status === "death-settled" || result.healedHp === 0) {
    return "";
  }

  const healedHp = result.healedHp;
  const maxHp = result.row.stats.maxHp;
  const remainingHp = result.remainingHp;
  const content = `${source.name}恢复了${healedHp}点生命；剩余 HP ${remainingHp}/${maxHp}。`;
  await appendPublicMessage(input.executor, input.gameId, source.actorId, {
    kind: action,
    stageId: input.stage.id,
    targetActorId: healed.actorId,
    visibility: "stage",
    content,
  });
  await appendStageMemory(
    input.executor,
    input.gameId,
    input.stage.id,
    `# 舞台事件\n${content}`,
    { eventKind: action, targetActorId: healed.actorId },
    input.trace,
  );
  // 治疗同侧时发起者由行动反馈承载，观察只发给旁观者。
  await appendCustomObservation(
    input.executor,
    input.gameId,
    input.stage.id,
    source.actorId,
    { type: "stage" },
    (observerId, address) => {
      const healedAddress = address(healed.actorId);
      const isSelf = observerId === healed.actorId;
      const ref = isSelf ? "你" : mentionOf(healedAddress);
      return {
        content: withAppearances(
          `${ref}恢复了${healedHp}点生命；剩余 HP ${remainingHp}/${maxHp}。`,
          isSelf ? [] : [healedAddress],
        ),
        metadata: {
          kind: MEMORY_KINDS.actionObservation,
          stageId: input.stage.id,
          targetActorId: healed.actorId,
        },
      };
    },
    input.trace,
  );

  const ref =
    healed.actorId === source.actorId
      ? "你"
      : input.address
        ? actionRef(input.address(healed.actorId))
        : healed.name;
  return `你对${ref}恢复了${healedHp}点生命。`;
}

function sideOf(
  role: SettlementOutcome["effects"][number]["role"],
  input: ApplySettlementInput,
): ActorSnapshot | undefined {
  return role === "affected" ? input.affected : input.initiator;
}

export async function applySettlement(input: ApplySettlementInput): Promise<ApplySettlementResult> {
  const { executor, gameId, stage, action, itemName, via, initiator, trace } = input;
  const lines: string[] = [];
  let hit: SettlementHitResult | undefined;

  // 快照时目标已死：伤害空转，只留一句「已经倒下」，不写消息与观察。
  if (input.outcome.affectedWasDead && input.affected) {
    const ref = input.address
      ? actionRef(input.address(input.affected.actorId))
      : input.affected.name;
    lines.push(`${ref}已经倒下。`);
    hit = { actorId: input.affected.actorId, dealtDamage: 0, targetDied: false };
  }

  for (const effect of input.outcome.effects) {
    const side = sideOf(effect.role, input);
    if (!side) {
      continue;
    }
    if (effect.kind === "damage") {
      const written = await writeDamage({
        executor,
        gameId,
        stage,
        attacker: initiator,
        target: side,
        damage: -effect.hpDelta,
        action,
        ...(itemName ? { itemName } : {}),
        ...(via ? { via } : {}),
        now: input.now,
        ...(input.address ? { address: input.address } : {}),
        ...(trace ? { trace } : {}),
      });
      lines.push(written.feedback);
      hit = written.result;
      continue;
    }
    if (effect.kind === "heal") {
      const feedback = await writeHeal({
        executor,
        gameId,
        stage,
        source: initiator,
        healed: side,
        amount: effect.hpDelta,
        action,
        now: input.now,
        ...(input.address ? { address: input.address } : {}),
        ...(trace ? { trace } : {}),
      });
      if (feedback.length > 0) {
        lines.push(feedback);
      }
    }
  }

  if (input.outcome.hit && input.outcome.damageLines.length > 0 && input.affected) {
    await appendStageMemory(
      executor,
      gameId,
      stage.id,
      `# 舞台事件（词缀分解，减防前）\n${input.outcome.damageLines.map((line) => `- ${line}`).join("\n")}`,
      { eventKind: action, targetActorId: input.affected.actorId },
      trace,
    );
  }

  // 见证只属于词缀触发：`brawl` 没有道具，也就没有见证。
  const witnessAction: AffixTrigger | undefined = action === "brawl" ? undefined : action;
  if (witnessAction) {
    for (const witness of input.outcome.witnesses) {
      const target = input.affected
        ? { kind: "actor" as const, actorId: input.affected.actorId }
        : input.targetAnchor
          ? { kind: "anchor" as const, label: input.targetAnchor }
          : undefined;
      lines.push(
        await appendWitnessEvent({
          executor,
          gameId,
          action: witnessAction,
          stage,
          source: { id: initiator.actorId, name: initiator.name },
          ...(itemName ? { itemName } : {}),
          event: {
            affixName: witness.affixName,
            sourceActorId: initiator.actorId,
            ...(target ? { target } : {}),
            template: witness.template,
            visibility: witness.visibility,
          },
          ...(input.address ? { address: input.address } : {}),
          ...(trace ? { trace } : {}),
        }),
      );
    }
  }

  return { feedback: lines.join("\n"), ...(hit ? { hit } : {}) };
}
