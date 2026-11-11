import type { TraceContext } from "../../../debug/trace";
import { GameError } from "../../errors";
import {
  type AddressLookup,
  actionRef,
  findTextLeaks,
  mentionOf,
  NAME_MARKER_PATTERN,
} from "../../kernel/addressing";
import { type ObservationView, withAppearances } from "../../kernel/observation-text";
import { listStageActorViews } from "../../lookup";
import { MEMORY_KINDS } from "../../memory/kinds";
import { appendCustomObservation, appendStageMemory } from "../../observations";
import { appendPublicMessage } from "../../persistence/game-messages";
import type { ActorRow, Executor, StageRow } from "../../persistence/rows";

/**
 * 见证事件：静态 `witness` op 与 agent `record_witness` 共用同一份结构化事实。
 *
 * 文本本身不含名字：`{source}` / `{target}` / `{anchor}` / `{item}` 由引擎按收件人
 * 各自渲染，避免推理端把真名烧进别人的记忆。
 */
export type WitnessTarget = { kind: "actor"; actorId: string } | { kind: "anchor"; label: string };

export type WitnessEvent = {
  affixName: string;
  sourceActorId: string;
  target?: WitnessTarget;
  template: string;
  visibility: "stage" | "target";
};

/** 占位符替换；缺值时的占位交由调用方先行校验，这里只做机械替换。 */
function fillTemplate(
  template: string,
  values: { source: string; target?: string; anchor?: string; item: string },
): string {
  return template.replace(/\{(source|target|anchor|item)\}/g, (match, key: string) => {
    if (key === "source") {
      return values.source;
    }
    if (key === "target") {
      return values.target ?? match;
    }
    if (key === "anchor") {
      return values.anchor ?? match;
    }
    return values.item;
  });
}

/** 模板引用的占位符必须与目标形态一致；否则句子会留下裸占位符。 */
export function assertWitnessTargetMatches(event: WitnessEvent): void {
  if (event.template.includes("{target}") && event.target?.kind !== "actor") {
    throw new GameError("invalid_action", "见证模板引用了 {target}，但没有角色目标");
  }
  if (event.template.includes("{anchor}") && event.target?.kind !== "anchor") {
    throw new GameError("invalid_action", "见证模板引用了 {anchor}，但没有锚点目标");
  }
}

/**
 * 逐观察者渲染：目标本人用「你」，其余用各自地址渲染的引用；
 * 句子末尾补外观行，外观不冒充名字。
 */
export function renderWitness(
  stage: { id: string },
  event: WitnessEvent,
  itemName: string | undefined,
  observerId: string,
  address: AddressLookup,
): ObservationView {
  const sourceAddress = address(event.sourceActorId);
  const sourceRef = observerId === event.sourceActorId ? "你" : mentionOf(sourceAddress);
  const targetAddress = event.target?.kind === "actor" ? address(event.target.actorId) : undefined;
  const targetRef =
    event.target?.kind === "actor"
      ? observerId === event.target.actorId
        ? "你"
        : mentionOf(address(event.target.actorId))
      : undefined;
  const content = fillTemplate(event.template, {
    source: sourceRef,
    ...(targetRef ? { target: targetRef } : {}),
    ...(event.target?.kind === "anchor" ? { anchor: event.target.label } : {}),
    item: itemName ?? "它",
  });
  const mentioned = [sourceAddress, ...(targetAddress ? [targetAddress] : [])];
  return {
    content: withAppearances(content, mentioned),
    metadata: {
      kind: MEMORY_KINDS.actionObservation,
      stageId: stage.id,
      sourceActorId: event.sourceActorId,
      ...(event.target?.kind === "actor" ? { targetActorId: event.target.actorId } : {}),
      ...(event.target?.kind === "anchor" ? { targetAnchor: event.target.label } : {}),
      ...(itemName ? { itemName } : {}),
      affixName: event.affixName,
      witness: true,
    },
  };
}

export type AppendWitnessInput = {
  executor: Executor;
  gameId: string;
  action: "strike" | "cleave" | "use";
  stage: StageRow;
  source: ActorRow;
  itemName?: string;
  event: WitnessEvent;
  /** 出手者视角的引用；用于把见证写成行动反馈。 */
  address?: AddressLookup;
  trace?: TraceContext;
};

/**
 * 写一次见证：公共事件流（可关）、stage memory、舞台观察，并返回出手者的反馈句。
 *
 * 发起者不写 observation：他的认知走行动反馈，同一事实在记忆里只有一条。
 */
export async function appendWitnessEvent(input: AppendWitnessInput): Promise<string> {
  const { executor, gameId, action, stage, source, itemName, event, trace } = input;
  assertWitnessTargetMatches(event);
  if (NAME_MARKER_PATTERN.test(event.template)) {
    throw new GameError("invalid_action", "见证文本不能包含 # 标记");
  }
  const views = await listStageActorViews(executor, stage.id);
  const names = views.map(({ actor }) => actor.name);
  const leaks = findTextLeaks(event.template, names);
  if (leaks.length > 0) {
    throw new GameError(
      "invalid_action",
      `见证文本不能包含名字或编号: ${leaks.map((leak) => leak.token).join("、")}`,
    );
  }
  const target = event.target;
  const targetName =
    target?.kind === "actor"
      ? views.find(({ actor }) => actor.id === target.actorId)?.actor.name
      : undefined;
  const godContent = fillTemplate(event.template, {
    source: source.name,
    ...(targetName ? { target: targetName } : {}),
    ...(event.target?.kind === "anchor" ? { anchor: event.target.label } : {}),
    item: itemName ?? "它",
  });

  if (event.visibility === "stage") {
    await appendPublicMessage(executor, gameId, source.id, {
      kind: action,
      stageId: stage.id,
      ...(event.target?.kind === "actor" ? { targetActorId: event.target.actorId } : {}),
      visibility: "stage",
      content: godContent,
    });
  }
  await appendStageMemory(
    executor,
    gameId,
    stage.id,
    `# 舞台事件\n${godContent}`,
    {
      eventKind: action,
      ...(event.target?.kind === "actor" ? { targetActorId: event.target.actorId } : {}),
      ...(event.target?.kind === "anchor" ? { targetAnchor: event.target.label } : {}),
      ...(itemName ? { itemName } : {}),
      affixName: event.affixName,
      witness: true,
    },
    trace,
  );
  await appendCustomObservation(
    executor,
    gameId,
    stage.id,
    source.id,
    event.visibility === "target" && event.target?.kind === "actor"
      ? { type: "only", actorId: event.target.actorId }
      : { type: "stage" },
    (observerId, address) => renderWitness(stage, event, itemName, observerId, address),
    trace,
  );

  const targetRef =
    event.target?.kind === "actor"
      ? event.target.actorId === source.id
        ? "你"
        : input.address
          ? actionRef(input.address(event.target.actorId))
          : targetName
      : event.target?.kind === "anchor"
        ? event.target.label
        : undefined;
  return fillTemplate(event.template, {
    source: "你",
    ...(targetRef ? { target: targetRef } : {}),
    ...(event.target?.kind === "anchor" ? { anchor: event.target.label } : {}),
    item: itemName ?? "它",
  });
}
