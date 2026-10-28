/** JSON 值归一化：队列 payload / result 只存可序列化 JSON。 */

import type { JsonValue } from "../db/schema";

export function toJsonValue(value: unknown, label: string): JsonValue {
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch (error) {
    throw new TypeError(`${label} 不是可序列化的 JSON: ${String(error)}`);
  }
  if (text === undefined) {
    throw new TypeError(`${label} 不是 JSON 值`);
  }
  return JSON.parse(text) as JsonValue;
}
