import type { TraceContext } from "../../debug/trace";
import type { AddressLookup } from "../kernel/addressing";
import {
  type Audience,
  type CommunicationObservation,
  type DamageObservation,
  type InspectObservation,
  type ItemObservation,
  type ObservationView,
  renderCommunication,
  renderDamage,
  renderInspect,
  renderItemEvent,
  type StageRef,
} from "../kernel/observation-text";
import type { Executor } from "../persistence/rows";
import { STAGE_WIDE, writeObservations } from "./write";

/**
 * 各类事实的广播入口：只决定收件范围，文案交给 `observation-text/`。
 *
 * 收件范围是这个文件唯一的判断：`steal` 与耳语只写给目标，其余按舞台广播；
 * 发起者的认知一律走行动反馈，不在观察通道里重复。
 */

/**
 * 由调用方提供逐观察者渲染函数的一次舞台广播。
 *
 * 需要把当事人写进句子（离开、穿上、倒下）时用它：文案必须按观察者重新取引用，
 * 不能拿拼好真名的字符串广播。
 */
export async function appendCustomStageObservation(
  executor: Executor,
  gameId: string,
  stageId: string,
  sourceActorId: string,
  render: (observerId: string, address: AddressLookup) => ObservationView,
  trace?: TraceContext,
): Promise<void> {
  await writeObservations(
    executor,
    gameId,
    { stageId, excludeActorId: sourceActorId, audience: STAGE_WIDE, render },
    trace,
  );
}

/**
 * 由调用方提供逐观察者渲染函数与收件范围的一次观察广播。
 *
 * 与 `appendCustomStageObservation` 同源，额外允许「只有目标」这类收件范围；
 * 发起者仍由行动反馈承载，不从观察通道重复写。
 */
export async function appendCustomObservation(
  executor: Executor,
  gameId: string,
  stageId: string,
  sourceActorId: string,
  audience: Audience,
  render: (observerId: string, address: AddressLookup) => ObservationView,
  trace?: TraceContext,
): Promise<void> {
  await writeObservations(
    executor,
    gameId,
    { stageId, excludeActorId: sourceActorId, audience, render },
    trace,
  );
}

/** 写入伤害结果：发起者由行动结果反馈，目标与旁观者分别得到不同视角。 */
export async function appendDamageObservations(
  executor: Executor,
  gameId: string,
  stage: StageRef,
  observation: DamageObservation & {
    /** 谁收到伤害观察；省略时整个舞台。 */
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
      render: (observerId, address) => renderDamage(stage, facts, observerId, address),
    },
    trace,
  );
}

/**
 * 写入道具转移/拾取/使用事件的视角化记忆。
 *
 * `steal` 是私密事件，只有目标收到观察；其余按舞台广播。
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
      render: (observerId, address) => renderItemEvent(stage, observation, observerId, address),
    },
    trace,
  );
}

/**
 * 写入「有人查看了自己的行囊」的观察。
 *
 * 查看者由行动反馈承载，这里写给目标与在场其余角色；尸体收到的也是一句舞台动态，
 * 清单本身既不进公共消息也不进任何观察。
 */
export async function appendInspectObservations(
  executor: Executor,
  gameId: string,
  stage: StageRef,
  observation: InspectObservation,
  trace?: TraceContext,
): Promise<void> {
  await writeObservations(
    executor,
    gameId,
    {
      stageId: stage.id,
      excludeActorId: observation.actor.id,
      audience: STAGE_WIDE,
      render: (observerId, address) => renderInspect(stage, observation, observerId, address),
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
      render: (observerId, address) => renderCommunication(stage, observation, observerId, address),
    },
    trace,
  );
}
