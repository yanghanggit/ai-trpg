import { resolveAppearance } from "../agents/appearance/form";
import { GameError } from "../errors";
import { type AddressSubject, makeAddressLookup, refOf } from "../kernel/addressing";
import {
  appendMemoryMessages,
  buildActorOpeningObservation,
  loadAgentMemory,
  MEMORY_KINDS,
} from "../memory";
import type { Executor } from "../persistence/rows";
import type { World } from "../world-definition";
import type { OpeningActorRef } from "./types";

/**
 * 开局观察：第 0 刻「你在哪个舞台、同舞台有谁」，写进每个 actor 自己的记忆。
 *
 * system prompt 与开局简报是内容层写给角色的意图，不含当前状态；这条观察补上开局那一刻
 * 的处境，所以只凭记忆的探针也能回答「你在哪、旁边有谁」。名单走签名称呼：有称呼就写
 * 称呼，没有就写 `#编号` 加外观，与回合输入同一套地址；它不替角色认出谁。
 *
 * 它在称呼与起始到访之后写入，时刻固定为 0：排在两条开局消息之后就位，但不跟着「现在」漂。
 */
export async function bindOpeningObservations(
  tx: Executor,
  input: {
    gameId: string;
    world: World;
    actorRefs: Map<string, OpeningActorRef>;
  },
): Promise<void> {
  const { gameId, world, actorRefs } = input;
  const namesByObserver = new Map<string, Map<string, string>>();
  for (const binding of world.signatureNames ?? []) {
    const names = namesByObserver.get(binding.observer) ?? new Map<string, string>();
    names.set(binding.subject, binding.name);
    namesByObserver.set(binding.observer, names);
  }

  for (const actor of world.actors) {
    const ref = actorRefs.get(actor.key);
    const stage = world.stages.find((candidate) => candidate.key === actor.stageKey);
    if (!ref || !stage) {
      throw new GameError("invalid_state", `actor 缺少开局引用或舞台: ${actor.key}`);
    }
    const others = world.actors.filter(
      (other) =>
        other.key !== actor.key && other.stageKey === actor.stageKey && other.concealed !== true,
    );

    // 名单只投影同舞台的人；称呼按观察者自己的绑定，其余一律退回开局编号。
    const subjects = new Map<string, AddressSubject>();
    const listed: OpeningActorRef[] = [];
    for (const other of others) {
      const otherRef = actorRefs.get(other.key);
      if (!otherRef) {
        throw new GameError("invalid_state", `actor 缺少开局引用: ${other.key}`);
      }
      subjects.set(otherRef.actorId, {
        signatureId: otherRef.signatureId,
        signatureSeq: otherRef.signatureSeq,
        appearance: resolveAppearance(other.signature),
      });
      listed.push(otherRef);
    }
    const boundNames = namesByObserver.get(actor.key) ?? new Map<string, string>();
    const names = new Map<string, string>();
    for (const [subjectKey, name] of boundNames) {
      const subjectRef = actorRefs.get(subjectKey);
      if (subjectRef) {
        names.set(subjectRef.signatureId, name);
      }
    }
    const address = makeAddressLookup(names, subjects, [actor.name]);
    const roster = listed.map((other) => refOf(address(other.actorId)));

    const memory = await loadAgentMemory(tx, gameId, "actor", ref.actorId);
    if (!memory) {
      throw new GameError("invalid_state", `actor 缺少 memory: ${actor.name}`);
    }
    await appendMemoryMessages(
      tx,
      memory.row.id,
      [
        {
          type: "human",
          content: buildActorOpeningObservation({ stageName: stage.name, others: roster }),
          metadata: { kind: MEMORY_KINDS.actorOpeningObservation },
        },
      ],
      { at: 0 },
    );
  }
}
