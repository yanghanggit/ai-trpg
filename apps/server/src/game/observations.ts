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
    const memory = await loadAgentMemory(executor, gameId, observer.id);
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
          content: `# 你被攻击\n${attacker.name}对你使用${skill.name}${itemText}，造成${damage}点伤害；${
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
        content: `# 战斗\n${attacker.name}对${target.name}使用${skill.name}${itemText}，造成${damage}点伤害；${
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
