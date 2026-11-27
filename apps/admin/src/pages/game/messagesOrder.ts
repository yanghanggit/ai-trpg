/**
 * 事件流的读法：正序（旧在上）还是倒序（新在上）。
 *
 * 顺序是这一页的视图状态，不是数据口径——`game_messages` 永远按序号追加。所以它只影响
 * 怎么摆这张表，改它不发请求，也不改「有多少条」。
 *
 * 选择的去处有两层：地址栏（`?order=`，这一屏带着链接走）与本机偏好（下次进这一页还是
 * 这个样子）。地址栏说话时听地址栏，否则听偏好。
 */

import { readPref, writePref } from "../../lib/localPrefs";

export type MessageOrder = "asc" | "desc";

export const DEFAULT_MESSAGE_ORDER: MessageOrder = "asc";

const PREF_KEY = "ai-trpg.admin.messageOrder";

/**
 * 地址栏里的 `?order=` 优先；没写（或写得认不出）就用本机记住的那个。
 *
 * 认不出的值不当成「正序」——一个拼错的参数不该悄悄抹掉人记住的选择。
 */
export function resolveMessageOrder(
  param: string | null | undefined,
  stored: MessageOrder,
): MessageOrder {
  return param === "asc" || param === "desc" ? param : stored;
}

/** 记住的选择；没记过就是正序。 */
export function readOrderPreference(): MessageOrder {
  const stored = readPref(PREF_KEY);
  return stored === "desc" ? "desc" : DEFAULT_MESSAGE_ORDER;
}

export function writeOrderPreference(order: MessageOrder): void {
  writePref(PREF_KEY, order);
}

/**
 * 按序号排；倒序时最新的在最上面。
 *
 * 返回新数组，不改调用方手里那份——缓存里的列表还被别处读着。
 */
export function orderMessages<T extends { sequence: number }>(
  messages: readonly T[],
  order: MessageOrder,
): T[] {
  const sorted = [...messages].sort((left, right) => left.sequence - right.sequence);
  return order === "asc" ? sorted : sorted.reverse();
}
