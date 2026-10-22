import { eq } from "drizzle-orm";
import type { Database } from "../db/pool";
import { actors } from "../db/schema";
import type { ChatMessage } from "../llm/types";
import { type CommunicationActionType, MEMORY_KINDS, visibilityForCommunication } from "./actions";
import { appendMemoryMessages, loadAgentMemory } from "./memory";
import type { Skill, StageState } from "./types";

type Executor = Pick<Database, "select" | "insert" | "update">;
type ActorRow = typeof actors.$inferSelect;
type ObservationBuilder = (observer: ActorRow) => ChatMessage;

async function appendStageObservations(
  executor: Executor,
  gameId: string,
  stageId: string,
  excludedActorId: string,
  include: (observer: ActorRow) => boolean,
  build: ObservationBuilder,
): Promise<void> {
  const observerRows = await executor.select().from(actors).where(eq(actors.stageId, stageId));
  for (const observer of observerRows) {
    if (observer.id === excludedActorId || !include(observer)) {
      continue;
    }
    const memory = await loadAgentMemory(executor, gameId, "actor", observer.id);
    if (!memory) {
      continue;
    }
    await appendMemoryMessages(executor, memory.row.id, [build(observer)]);
  }
}

/** 向场景内其他 actor 写入环境变化观察。 */
export async function appendEnvironmentObservations(
  executor: Executor,
  gameId: string,
  stageId: string,
  actorId: string,
  content: string,
): Promise<void> {
  await appendStageObservations(
    executor,
    gameId,
    stageId,
    actorId,
    () => true,
    () => ({
      type: "human",
      content,
      metadata: { kind: MEMORY_KINDS.environmentObservation, stageId },
    }),
  );
}

/** 向场景内其他 actor 写入可见行动观察。 */
export async function appendActionObservations(
  executor: Executor,
  gameId: string,
  stageId: string,
  actorId: string,
  content: string,
): Promise<void> {
  await appendStageObservations(
    executor,
    gameId,
    stageId,
    actorId,
    () => true,
    () => ({
      type: "human",
      content,
      metadata: { kind: MEMORY_KINDS.actionObservation, stageId },
    }),
  );
}

/** 写入技能结果：发起者由行动结果反馈，目标与同场景旁观者分别得到不同视角。 */
export async function appendSkillObservations(
  executor: Executor,
  gameId: string,
  stage: Pick<StageState, "id" | "name">,
  attacker: { id: string; name: string },
  target: { id: string; name: string; maxHp: number },
  skill: Skill,
  items: readonly { name: string }[],
  damage: number,
  remainingHp: number,
  death: boolean,
): Promise<void> {
  const itemText = items.length > 0 ? `（使用${items.map((item) => item.name).join("、")}）` : "";
  await appendStageObservations(
    executor,
    gameId,
    stage.id,
    attacker.id,
    (observer) => skill.broadcast === "stage" || observer.id === target.id,
    (observer) => {
      if (observer.id === target.id) {
        return {
          type: "human",
          content: `# 你被攻击\n${attacker.name}对你使用攻击${itemText}，造成${damage}点伤害；${
            death ? "你倒下了" : `你剩余 HP ${remainingHp}/${target.maxHp}`
          }。`,
          metadata: {
            kind: MEMORY_KINDS.actionObservation,
            stageId: stage.id,
            attackerActorId: attacker.id,
          },
        };
      }
      return {
        type: "human",
        content: `# 战斗\n${attacker.name}对${target.name}使用攻击${itemText}，造成${damage}点伤害；${
          death ? `${target.name}倒下了` : `${target.name}剩余 HP ${remainingHp}/${target.maxHp}`
        }。`,
        metadata: {
          kind: MEMORY_KINDS.actionObservation,
          stageId: stage.id,
          attackerActorId: attacker.id,
          targetActorId: target.id,
        },
      };
    },
  );
}

export type ItemEvent = "steal" | "give" | "pickup" | "use";

/** 写入物品转移/拾取/使用事件的视角化记忆；私密事件只写目标。 */
export async function appendItemObservations(
  executor: Executor,
  gameId: string,
  stage: Pick<StageState, "id" | "name">,
  actor: { id: string; name: string },
  event: ItemEvent,
  itemName: string,
  options: {
    target?: { id: string; name: string };
    targetStageName?: string;
    broadcast: "stage" | "private";
  },
): Promise<void> {
  const { target, targetStageName, broadcast } = options;
  await appendStageObservations(
    executor,
    gameId,
    stage.id,
    actor.id,
    (observer) => broadcast === "stage" || observer.id === target?.id,
    (observer) => {
      if (target && observer.id === target.id) {
        const content =
          event === "steal"
            ? `# 你被窃取\n${actor.name}从你身上取走了${itemName}。`
            : event === "give"
              ? `# 你收到物品\n${actor.name}把${itemName}交给了你。`
              : `# 你被使用道具\n${actor.name}对你使用了${itemName}。`;
        return {
          type: "human",
          content,
          metadata: {
            kind: MEMORY_KINDS.actionObservation,
            stageId: stage.id,
            itemName,
          },
        };
      }
      const content =
        event === "steal"
          ? `# 场景动态\n${actor.name}从${target?.name ?? "某人"}身上取走了${itemName}。`
          : event === "give"
            ? `# 场景动态\n${actor.name}把${itemName}交给了${target?.name ?? "某人"}。`
            : event === "pickup"
              ? `# 场景动态\n${actor.name}拾取了${itemName}。`
              : target
                ? `# 场景动态\n${actor.name}对${target.name}使用了${itemName}。`
                : `# 场景动态\n${actor.name}在${stage.name}使用了${itemName}。`;
      return {
        type: "human",
        content,
        metadata: {
          kind: MEMORY_KINDS.actionObservation,
          stageId: stage.id,
          itemName,
          ...(target ? { targetActorId: target.id } : {}),
          ...(targetStageName ? { targetStageName } : {}),
        },
      };
    },
  );
}

/** 向 stage 自己的 memory 写入它看到的本场景事件。 */
export async function appendStageEvent(
  executor: Executor,
  gameId: string,
  stageId: string,
  content: string,
  metadata: Record<string, unknown> = {},
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
}

/** 按沟通方式向目标与旁观者写入听觉观察。 */
export async function appendCommunicationObservations(
  executor: Executor,
  gameId: string,
  stage: Pick<StageState, "id" | "name">,
  speaker: { id: string; name: string },
  mode: CommunicationActionType,
  target: { id: string; name: string } | undefined,
  message: string,
): Promise<void> {
  if ((mode === "say" || mode === "whisper") && !target) {
    throw new Error(`${mode} 缺少目标 actor`);
  }

  await appendStageObservations(
    executor,
    gameId,
    stage.id,
    speaker.id,
    (observer) => mode !== "whisper" || observer.id === target?.id,
    (observer) => {
      let content: string;
      if (mode === "whisper") {
        content = `# 你听见\n${speaker.name}对你耳语（场景：${stage.name}）：${message}`;
      } else if (mode === "say") {
        content =
          observer.id === target?.id
            ? `# 你听见\n${speaker.name}对你说（场景：${stage.name}）：${message}`
            : `# 你听见\n${speaker.name}对${target?.name}说（场景：${stage.name}）：${message}`;
      } else {
        content = `# 你听见\n${speaker.name}公开说（场景：${stage.name}）：${message}`;
      }

      return {
        type: "human",
        content,
        metadata: {
          kind: MEMORY_KINDS.communicationObservation,
          visibility: visibilityForCommunication(mode),
          stageId: stage.id,
          speakerActorId: speaker.id,
          ...(target ? { targetActorId: target.id } : {}),
        },
      };
    },
  );
}
