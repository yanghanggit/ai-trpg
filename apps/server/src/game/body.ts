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

/**
 * 当前可见外观：优先使用显式 appearance（衣着、装备、伤势等）；
 * 动物/怪物没有单独外观时回退到 base body 描述。
 */
export function resolveAppearance(actor: { baseBody: BaseBody; appearance?: string }): string {
  const appearance = actor.appearance?.trim();
  return appearance && appearance.length > 0 ? appearance : actor.baseBody.description;
}
