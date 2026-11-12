import type { ActorState, StageState } from "../kernel/types";

/**
 * 感知投影：谁能被谁看见。
 *
 * 隐匿是 actor 的运行时状态，不是外观文本；所有 actor-facing 的名单、目标与引用都走
 * 这一层。隐匿者自己始终看得见自己，也看得见旁人；隐藏只影响旁人如何看它。
 *
 * 以后若要加“敏捷识破”，只改 `isPerceivedBy`，不要在名单与动作里各写一份判断。
 */
export function isPerceivedBy(
  observerId: string,
  subject: Pick<ActorState, "id" | "concealed">,
): boolean {
  return subject.id === observerId || !subject.concealed;
}

/** 观察者能看见的本舞台角色，含自己。 */
export function perceivedActorsFor(stage: StageState, observerId: string): ActorState[] {
  return stage.actors.filter((actor) => isPerceivedBy(observerId, actor));
}

/** 观察者能看见的同舞台其他角色；尸体也算，只要没有被隐匿。 */
export function perceivedOthersInStage(stage: StageState, actorId: string): ActorState[] {
  return perceivedActorsFor(stage, actorId).filter((actor) => actor.id !== actorId);
}
