import type { World } from "./world-definition";
import { checkWorldInvariants } from "./world-invariants";
import { worldSchema } from "./world-schema";

const contentSchema = worldSchema.superRefine(checkWorldInvariants);

/**
 * 校验并收窄外部内容；CLI 的 --world-file 与 seed 都经过这里。
 *
 * 世界职能宪法必须由内容层给出（种子在剧本构建时定档），框架不再代劳装配：
 * 缺失或残缺会在这一步被拒绝。
 */
export function parseWorldContent(value: unknown): World {
  return contentSchema.parse(value);
}
