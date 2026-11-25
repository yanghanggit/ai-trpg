import type { ActionOrderEntryState } from "../kernel/types";

/**
 * 谁快轮到：回合计数最少者，同值取名次靠前。
 *
 * 只看计数，不看世界——「还能不能轮到他」由调用方先筛成候选集（眼下只有死者出局；
 * 玩家角色和 NPC 一样排队，区别只在谁执行）。纯函数：同一份计数必然算出同一个结果，
 * 服务端与客户端各自算也对得上，这条定义就是「期望」与「偏离」的基准。
 *
 * 条目本来就是按名次升序的，同值保留先遇到的那条即可，不必再比一次名次。
 */
export function nextEntry(
  entries: readonly ActionOrderEntryState[],
  eligible: ReadonlySet<string>,
): ActionOrderEntryState | null {
  let picked: ActionOrderEntryState | undefined;
  for (const entry of entries) {
    if (!eligible.has(entry.actorId)) {
      continue;
    }
    if (picked === undefined || entry.turnsTaken < picked.turnsTaken) {
      picked = entry;
    }
  }
  return picked ?? null;
}
