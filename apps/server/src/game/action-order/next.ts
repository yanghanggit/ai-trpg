import type { ActionOrderEntryState, ActionOrderNextActorState } from "../kernel/types";

/**
 * 谁快轮到：回合计数最少者，同值取名次靠前。
 *
 * 只看账本，不看世界——谁还能被推进由调用方先筛成候选集（死者、玩家角色交给 agent
 * 回合只会失败）。纯函数：同一份计数必然算出同一个结果，服务端与客户端各自算也对得上，
 * 这条定义就是「期望」与「偏离」的基准。
 *
 * 条目本来就是按名次升序的，同值保留先遇到的那条即可，不必再比一次名次。
 */
export function nextEntry(
  entries: readonly ActionOrderEntryState[],
  candidates: ReadonlySet<string>,
): ActionOrderNextActorState | null {
  let picked: ActionOrderEntryState | undefined;
  for (const entry of entries) {
    if (!candidates.has(entry.actorId)) {
      continue;
    }
    if (picked === undefined || entry.turnsTaken < picked.turnsTaken) {
      picked = entry;
    }
  }
  if (picked === undefined) {
    return null;
  }
  return { position: picked.position, actorId: picked.actorId, actorName: picked.actorName };
}
