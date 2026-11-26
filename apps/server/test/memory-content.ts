/**
 * 记忆消息的正文：去掉引擎盖在最前面的时刻行。
 *
 * 时刻本身由记忆层统一盖上（`第 N 刻`），断言正文的测试不该被迫复制那一行。
 */
export function memoryBody(content: string): string {
  return content.replace(/^第 \d+ 刻\n\n/, "");
}
