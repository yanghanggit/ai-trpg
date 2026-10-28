/**
 * 观察写入层：把已经发生的事实，按观察者视角写进各自的 agent memory。
 *
 * 同一件事有三份投影，互不替代：`game_messages` 是上帝视角的公共事件流
 * （`apply/messages.ts`），发起者的认知走行动反馈（`apply/index.ts`），这里写的是旁观者
 * 与当事人的主观记忆。由此有三条不变量：
 * - 发起者从不给自己写观察，同一事实在记忆里只有一条；
 * - 观察者集合是事实发生后该场景的 actor 行（含尸体），所以 `move` 的移动者收不到自己的
 *   离开/进入观察；
 * - 文案与 metadata 全部由 `observation-text.ts` 构造，这里只决定「写给谁」。
 */

import { type TraceContext, traceEvent } from "../debug/trace";
import { type AddressLookup, type AddressSubject, handleOf, makeAddressLookup } from "./addressing";
import { listStageActorViews } from "./apply/queries";
import type { ActorRow, Executor } from "./apply/types";
import { MEMORY_KINDS } from "./constants";
import { appendMemoryMessages, loadAgentMemory } from "./memory";
import {
  type Audience,
  type CommunicationObservation,
  type DamageObservation,
  type ItemObservation,
  type ObservationView,
  renderCommunication,
  renderDamage,
  renderItemEvent,
  type StageRef,
} from "./observation-text";
import { listKnowledge } from "./persistence/knowledge";
import type { ObservationMetadata, StageEventMetadata } from "./types";

/** 场景广播：场景内除发起者外的所有 actor。 */
const STAGE_WIDE: Audience = { type: "stage" };

type ObservationSpec = {
  stageId: string;
  /** 事实的发起者；他自己的认知走行动反馈，这里不再重复写。 */
  excludeActorId: string;
  audience: Audience;
  render: (observer: ActorRow, address: AddressLookup) => ObservationView;
};

function sees(observer: ActorRow, audience: Audience): boolean {
  return audience.type === "stage" || observer.id === audience.actorId;
}

/**
 * 向场景内的 actor 逐一写入观察。
 *
 * 这里是尽力而为：场景里缺 memory 的 actor 跳过，不让一条记忆缺失回滚整次行动。
 * stage / world 自己是单 owner 不变量，缺 memory 直接抛（见 `appendStageMemory`）。
 */
async function writeObservations(
  executor: Executor,
  gameId: string,
  spec: ObservationSpec,
  trace?: TraceContext,
): Promise<void> {
  const views = await listStageActorViews(executor, spec.stageId);
  const knowledgeRows = await listKnowledge(executor, gameId);
  // 主体表：场景内每个角色当前的可见外观；名字信念按观察者各自过滤。
  const subjects = new Map<string, AddressSubject>(
    views.map(({ actor, presentation }) => [
      actor.id,
      {
        actorId: actor.id,
        presentationId: presentation.id,
        presentationSeq: presentation.seq,
        appearance: presentation.appearance,
      },
    ]),
  );
  const recipients: { actorId: string; actorName: string; content: string }[] = [];
  let kind = "unknown";
  for (const { actor: observer, presentation } of views) {
    if (observer.id === spec.excludeActorId || !sees(observer, spec.audience)) {
      continue;
    }
    const memory = await loadAgentMemory(executor, gameId, "actor", observer.id);
    if (!memory) {
      continue;
    }
    const knownNames = new Map(
      knowledgeRows
        .filter((row) => row.observerActorId === observer.id)
        .map((row) => [row.presentationId, row.name]),
    );
    const base = makeAddressLookup(knownNames, subjects);
    const address: AddressLookup = (actorId) =>
      actorId === observer.id
        ? {
            token: handleOf(presentation.seq),
            label: "你自己",
            mention: "你",
            knownName: observer.name,
          }
        : base(actorId);
    const view = spec.render(observer, address);
    kind = String(view.metadata.kind);
    recipients.push({ actorId: observer.id, actorName: observer.name, content: view.content });
    await appendMemoryMessages(executor, memory.row.id, [{ type: "human", ...view }]);
  }

  // 收件人为空也记一条：谁都没看到，本身就是一次可归因的事实。
  const source = views.find((view) => view.actor.id === spec.excludeActorId)?.actor;
  await traceEvent(trace, {
    event: "observed",
    via: "stage-actors",
    kind,
    stageId: spec.stageId,
    sourceActorId: spec.excludeActorId,
    ...(source ? { sourceActorName: source.name } : {}),
    recipients,
  });
}

/**
 * 由调用方提供逐观察者渲染函数的一次场景广播。
 *
 * 需要把当事人写进句子（离开、穿上、倒下）时用它：文案必须按观察者重新取指代，
 * 不能拿拼好真名的字符串广播。
 */
export async function appendCustomStageObservation(
  executor: Executor,
  gameId: string,
  stageId: string,
  sourceActorId: string,
  render: (observer: ActorRow, address: AddressLookup) => ObservationView,
  trace?: TraceContext,
): Promise<void> {
  await writeObservations(
    executor,
    gameId,
    { stageId, excludeActorId: sourceActorId, audience: STAGE_WIDE, render },
    trace,
  );
}

/** 写入伤害结果：发起者由行动结果反馈，目标与旁观者分别得到不同视角。 */
export async function appendDamageObservations(
  executor: Executor,
  gameId: string,
  stage: StageRef,
  observation: DamageObservation & {
    /** 谁收到伤害观察；省略时整个场景。 */
    audience?: Audience;
  },
  trace?: TraceContext,
): Promise<void> {
  const { audience = STAGE_WIDE, ...facts } = observation;
  await writeObservations(
    executor,
    gameId,
    {
      stageId: stage.id,
      excludeActorId: facts.attacker.id,
      audience,
      render: (observer, address) => renderDamage(stage, facts, observer.id, address),
    },
    trace,
  );
}

/**
 * 写入物品转移/拾取/使用事件的视角化记忆。
 *
 * `steal` 是私密事件，只有目标收到观察；其余按场景广播。
 */
export async function appendItemObservations(
  executor: Executor,
  gameId: string,
  stage: StageRef,
  observation: ItemObservation,
  trace?: TraceContext,
): Promise<void> {
  await writeObservations(
    executor,
    gameId,
    {
      stageId: stage.id,
      excludeActorId: observation.actor.id,
      audience:
        observation.event === "steal"
          ? { type: "only", actorId: observation.target.id }
          : STAGE_WIDE,
      render: (observer, address) => renderItemEvent(stage, observation, observer.id, address),
    },
    trace,
  );
}

/** 按沟通方式向目标与旁观者写入听觉观察：耳语只有对方能听见。 */
export async function appendCommunicationObservations(
  executor: Executor,
  gameId: string,
  stage: StageRef,
  observation: CommunicationObservation,
  trace?: TraceContext,
): Promise<void> {
  await writeObservations(
    executor,
    gameId,
    {
      stageId: stage.id,
      excludeActorId: observation.source.id,
      audience:
        observation.kind === "whisper"
          ? { type: "only", actorId: observation.target.id }
          : STAGE_WIDE,
      render: (observer, address) => renderCommunication(stage, observation, observer.id, address),
    },
    trace,
  );
}

/**
 * 只写给当事人自己的观察：死亡这类「旁观者知道结果、细节只属于自己」的事实。
 *
 * 与场景广播一样是尽力而为，缺 memory 时跳过。
 */
export async function appendSelfObservation(
  executor: Executor,
  gameId: string,
  stageId: string,
  actorId: string,
  content: string,
  metadata: Omit<ObservationMetadata, "kind" | "stageId"> = {},
  trace?: TraceContext,
): Promise<void> {
  const memory = await loadAgentMemory(executor, gameId, "actor", actorId);
  if (!memory) {
    return;
  }
  await appendMemoryMessages(executor, memory.row.id, [
    {
      type: "human",
      content,
      metadata: { kind: MEMORY_KINDS.actionObservation, stageId, ...metadata },
    },
  ]);
  await traceEvent(trace, {
    event: "observed",
    via: "self",
    kind: MEMORY_KINDS.actionObservation,
    stageId,
    recipients: [{ actorId, actorName: memory.row.name, content }],
  });
}

/**
 * 向 stage 自己的 memory 写入它看到的本场景事件。
 *
 * 与 actor 观察相反，stage 是单 owner 不变量：缺 memory 直接抛，不做尽力而为。
 * 它只需要 stageId：场景名不会出现在自己发给自己的事件里。
 */
export async function appendStageMemory(
  executor: Executor,
  gameId: string,
  stageId: string,
  content: string,
  metadata: StageEventMetadata,
  trace?: TraceContext,
): Promise<void> {
  const memory = await loadAgentMemory(executor, gameId, "stage", stageId);
  if (!memory) {
    throw new Error(`stage 缺少 memory: ${stageId}`);
  }
  await appendMemoryMessages(executor, memory.row.id, [
    {
      type: "human",
      content,
      metadata: {
        kind: MEMORY_KINDS.stageObservation,
        stageId,
        ...metadata,
      },
    },
  ]);
  await traceEvent(trace, {
    event: "observed",
    via: "stage-memory",
    kind: MEMORY_KINDS.stageObservation,
    stageId,
    content,
  });
}
