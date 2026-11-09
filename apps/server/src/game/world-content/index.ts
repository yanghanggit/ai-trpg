import type { World } from "../world-definition";
import { checkWorldInvariants } from "./invariants";
import { worldSchema } from "./schema";

/**
 * 世界内容的解析入口：zod 形状 + 跨实体不变量，最后收窄成 `World`。
 *
 * 分两层是因为两类规则需要的视野不同：单看一个实体就能判的形状在 `schema.ts`，
 * 要看整张图的规则（名字唯一、环境文本不点名未通场景、职能宪法齐全）在 `invariants.ts`。
 * 这是内容层的唯一入口：CLI 的 `--world-file`、内容包与种子都经过 `parseWorldContent`。
 */

/** 完整的内容校验：形状 + 跨实体不变量。schema 只构建一次，不必每次解析重建 superRefine。 */
const contentSchema = worldSchema.superRefine(checkWorldInvariants);

/**
 * 校验并收窄外部内容。
 *
 * 世界职能宪法必须由内容层给出（种子在剧本构建时定档），框架不代劳装配：
 * 缺失或残缺会在这一步被拒绝。
 */
export function parseWorldContent(value: unknown): World {
  return contentSchema.parse(value);
}
