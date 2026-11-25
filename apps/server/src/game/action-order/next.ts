import type { ActionOrderEntryState } from "../kernel/types";

/**
 * 谁快轮到：回合计数最少者，同值取名次靠前（条目已按名次升序，故保留先遇到的）。
 *
 * 纯函数，只看计数：能不能轮到他由调用方先筛成 `eligible`。服务端与客户端拿同一份
 * 计数算出同一个结果，这条定义就是「期望」与「偏离」的基准。
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
