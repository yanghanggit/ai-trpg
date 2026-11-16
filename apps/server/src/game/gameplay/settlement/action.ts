import type { TraceContext } from "../../../debug/trace";
import type { AddressLookup } from "../../kernel/addressing";
import type { AffixTrigger } from "../../kernel/types";
import type { ActorRow, ActorWithStageRow, Executor, StageRow } from "../../persistence/rows";
import { applySettlement } from "./apply";
import { resolveRules } from "./rules";
import { settle } from "./settle";
import { buildActorSnapshot } from "./snapshot";
import type { ItemSnapshot, SettlementHitResult, SettlementOutcome } from "./types";

/**
 * 道具动作的结算入口：生成快照 → `settle` → `applySettlement`。
 *
 * `strike` / `cleave` / `use` / `fit` 共用它；差异只有触发名与目标形态。
 * `cleave` 需要共享一份发起者快照，因此单目标动作走这里，多目标直接调底层三步。
 */

export type ApplyItemActionInput = {
  executor: Executor;
  gameId: string;
  stage: StageRow;
  actorRow: ActorWithStageRow;
  item: ItemSnapshot;
  action: AffixTrigger;
  target?: ActorRow;
  targetAnchor?: string;
  now: Date;
  address: AddressLookup;
  ambush?: boolean;
  /** 动作发生前的隐匿状态；省略时退回 `ambush`。 */
  concealed?: boolean;
  trace?: TraceContext;
};

export type ApplyItemActionResult = {
  feedback: string;
  settlement: SettlementOutcome;
  hit?: SettlementHitResult;
};

export async function applyItemAction(input: ApplyItemActionInput): Promise<ApplyItemActionResult> {
  const ambush = input.ambush ?? false;
  const initiator = await buildActorSnapshot({
    executor: input.executor,
    actor: input.actorRow.actor,
    role: "initiator",
    mode: "armed",
    concealed: input.concealed ?? ambush,
    instrument: input.item,
  });
  const affected = input.target
    ? await buildActorSnapshot({
        executor: input.executor,
        actor: input.target,
        role: "affected",
        mode: "armed",
        concealed: false,
      })
    : undefined;

  const outcome = settle({
    action: input.action,
    initiator,
    ...(affected ? { affected } : {}),
    item: input.item,
    rules: resolveRules(),
    ambush,
  });
  const applied = await applySettlement({
    executor: input.executor,
    gameId: input.gameId,
    stage: input.stage,
    address: input.address,
    now: input.now,
    action: input.action,
    itemName: input.item.name,
    initiator,
    ...(affected ? { affected } : {}),
    ...(input.targetAnchor ? { targetAnchor: input.targetAnchor } : {}),
    outcome,
    ...(input.trace ? { trace: input.trace } : {}),
  });

  return {
    feedback: applied.feedback,
    settlement: outcome,
    ...(applied.hit ? { hit: applied.hit } : {}),
  };
}

/** 肉搏：同一条结算，只把发起者的生成规则换成 unarmed。 */
export async function applyUnarmedAction(input: {
  executor: Executor;
  gameId: string;
  stage: StageRow;
  actorRow: ActorWithStageRow;
  target: ActorRow;
  now: Date;
  address: AddressLookup;
  ambush?: boolean;
  trace?: TraceContext;
}): Promise<{ feedback: string; settlement: SettlementOutcome; hit?: SettlementHitResult }> {
  const ambush = input.ambush ?? false;
  const initiator = await buildActorSnapshot({
    executor: input.executor,
    actor: input.actorRow.actor,
    role: "initiator",
    mode: "unarmed",
    concealed: ambush,
  });
  const affected = await buildActorSnapshot({
    executor: input.executor,
    actor: input.target,
    role: "affected",
    mode: "armed",
    concealed: false,
  });
  const outcome = settle({
    action: "brawl",
    initiator,
    affected,
    rules: resolveRules(),
    ambush,
  });
  const applied = await applySettlement({
    executor: input.executor,
    gameId: input.gameId,
    stage: input.stage,
    address: input.address,
    now: input.now,
    action: "brawl",
    initiator,
    affected,
    outcome,
    ...(input.trace ? { trace: input.trace } : {}),
  });

  return {
    feedback: applied.feedback,
    settlement: outcome,
    ...(applied.hit ? { hit: applied.hit } : {}),
  };
}
