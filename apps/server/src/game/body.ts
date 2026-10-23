import type { BaseBody } from "./types";

/**
 * 把 base body 导出为 prompt 可用的外观快照。
 *
 * base body 是“捏脸完成、还没穿装备”的形态；之后由 LLM 把 base body
 * 与装备、伤势等融合成真正的 appearance。
 */
export function formatBaseBody(baseBody: BaseBody): string {
  return `[${baseBody.race}] ${baseBody.description}`;
}
