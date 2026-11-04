import type { World } from "./world-definition";
import { checkWorldInvariants } from "./world-invariants";
import { worldSchema } from "./world-schema";

const contentSchema = worldSchema.superRefine(checkWorldInvariants);

/** 校验并收窄外部内容；CLI 的 --world-file 与 seed 都经过这里。 */
export function parseWorldContent(value: unknown): World {
  return contentSchema.parse(value);
}
