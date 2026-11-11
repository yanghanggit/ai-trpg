import { type TraceContext, traceEvent } from "../../debug/trace";
import {
  type AddressLookup,
  type AddressSubject,
  makeAddressLookup,
  withSelf,
} from "../kernel/addressing";
import type { Audience, ObservationView } from "../kernel/observation-text";
import { listStageActorViews } from "../lookup";
import { appendMemoryMessages, loadAgentMemory } from "../memory";
import type { ActorRow, Executor } from "../persistence/rows";
import { listSignatureNames } from "../persistence/signature-names";

/**
 * 场景广播的写入核心：把一条按观察者渲染的事实，写进该场景每个 actor 的 memory。
 *
 * 三条不变量：
 * - 发起者从不给自己写观察（同一事实在记忆里只有一条，走行动反馈）；
 * - 观察者集合是事实发生后该场景的 actor 行（含尸体），所以 `move` 的移动者收不到
 *   自己的离开/进入观察；
 * - 文案与 metadata 全部由 `observation-text/` 构造，这里只决定「写给谁」。
 */

/** 场景广播：场景内除发起者外的所有 actor。 */
export const STAGE_WIDE: Audience = { type: "stage" };

export type ObservationSpec = {
  stageId: string;
  /** 事实的发起者；他自己的认知走行动反馈，这里不再重复写。 */
  excludeActorId: string;
  audience: Audience;
  /** 观察者只以 id 传入：名字必须由 address 渲染，避免 renderer 直接拼真名。 */
  render: (observerId: string, address: AddressLookup) => ObservationView;
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
export async function writeObservations(
  executor: Executor,
  gameId: string,
  spec: ObservationSpec,
  trace?: TraceContext,
): Promise<void> {
  const views = await listStageActorViews(executor, spec.stageId);
  const signatureNameRows = await listSignatureNames(executor, gameId);
  // 主体表：场景内每个角色当前的可见外观；名字按观察者各自过滤。
  const subjects = new Map<string, AddressSubject>(
    views.map(({ actor, signature, appearance }) => [
      actor.id,
      {
        signatureId: signature.id,
        signatureSeq: signature.seq,
        appearance: appearance.text,
      },
    ]),
  );
  const recipients: { actorId: string; actorName: string; content: string }[] = [];
  let kind = "unknown";
  for (const { actor: observer, appearance } of views) {
    if (observer.id === spec.excludeActorId || !sees(observer, spec.audience)) {
      continue;
    }
    const memory = await loadAgentMemory(executor, gameId, "actor", observer.id);
    if (!memory) {
      continue;
    }
    const names = new Map(
      signatureNameRows
        .filter((row) => row.observerActorId === observer.id)
        .map((row) => [row.signatureId, row.name] as const),
    );
    const address = withSelf(makeAddressLookup(names, subjects, [observer.name]), {
      id: observer.id,
      name: observer.name,
      appearance: appearance.text,
    });
    const view = spec.render(observer.id, address);
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
