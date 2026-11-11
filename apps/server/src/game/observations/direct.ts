import { type TraceContext, traceEvent } from "../../debug/trace";
import { assertWorldFaceText } from "../kernel/addressing";
import type {
  ObservationMetadata,
  ObservationView,
  StageEventMetadata,
} from "../kernel/observation-text";
import { listStageActorViews } from "../lookup";
import {
  appendMemoryMessages,
  ensureStageOpeningSnapshot,
  hasStageOpeningSnapshot,
  loadAgentMemory,
} from "../memory";
import { MEMORY_KINDS } from "../memory/kinds";
import type { Executor } from "../persistence/rows";
import { loadStageById } from "../persistence/stages";

/**
 * 不走舞台广播的三条通道：写给当事人自己、写给单个远端 actor、写给 stage 自己。
 *
 * 与广播相反，它们不按观察者渲染（跨舞台没有共同的地址表），因此调用方必须已经
 * 备好文本；这里只做 owner 定位、守卫、落账与轨迹。
 */

/**
 * 只写给当事人自己的观察：死亡这类「旁观者知道结果、细节只属于自己」的事实。
 *
 * 与舞台广播一样是尽力而为，缺 memory 时跳过。
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
  // 自述是写给“你”的，不需要名字与引用；它只由引擎为确定性事实写入（死亡等），
  // 推理端不得调用。
  const actorNames = (await listStageActorViews(executor, stageId)).map(({ actor }) => actor.name);
  assertWorldFaceText(content, actorNames, "自述");
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
 * 向单个 actor 写一条已经渲染好的观察。
 *
 * 跨舞台传音的目标不在来源舞台里，不能走舞台 broadcaster；调用方负责按目标视角
 * 渲染引用与内容，这里只做 owner 定位、落账与轨迹。
 */
export async function appendDirectObservation(
  executor: Executor,
  gameId: string,
  stageId: string,
  actorId: string,
  view: ObservationView,
  trace?: TraceContext,
): Promise<void> {
  const memory = await loadAgentMemory(executor, gameId, "actor", actorId);
  if (!memory) {
    return;
  }
  await appendMemoryMessages(executor, memory.row.id, [{ type: "human", ...view }]);
  await traceEvent(trace, {
    event: "observed",
    via: "direct",
    kind: String(view.metadata.kind),
    stageId,
    recipients: [{ actorId, actorName: memory.row.name, content: view.content }],
  });
}

/**
 * 向 stage 自己的 memory 写入它看到的本舞台事件。
 *
 * 与 actor 观察相反，stage 是单 owner 不变量：缺 memory 直接抛，不做尽力而为。
 * 它只需要 stageId：舞台名不会出现在自己发给自己的事件里。
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
  // 事件可能早于第一次仲裁，基线必须先落账。
  if (!hasStageOpeningSnapshot(memory)) {
    const stage = await loadStageById(executor, stageId);
    if (stage && (await ensureStageOpeningSnapshot(executor, memory, stage))) {
      await traceEvent(trace, {
        event: "observed",
        via: "stage-memory",
        kind: MEMORY_KINDS.stageOpeningSnapshot,
        stageId,
      });
    }
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
