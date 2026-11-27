/**
 * 事件流的读法：正序（旧在上）还是倒序（新在上）。
 *
 * 顺序是这一页的视图状态，不是数据口径——`game_messages` 永远按序号追加。所以它只影响
 * 怎么摆这张表，改它不发请求，也不改「有多少条」。放在地址栏里，是为了倒过来看的那一屏
 * 可以带着链接走。
 */

export type MessageOrder = "asc" | "desc";

export const DEFAULT_MESSAGE_ORDER: MessageOrder = "asc";

/** 地址栏里的 `?order=`：只认 `desc`，其余（含缺省）都是正序。 */
export function parseMessageOrder(value: string | null | undefined): MessageOrder {
  return value === "desc" ? "desc" : DEFAULT_MESSAGE_ORDER;
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
