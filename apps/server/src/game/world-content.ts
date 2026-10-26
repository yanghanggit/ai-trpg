import { z } from "zod";
import { ACTION_KINDS } from "./actions";
import type { StageActionKind, World, WorldActionKind } from "./types";

/** 十二个动作直接复用运行时清单，避免新增动作时漏改。 */
const actionKindSchema = z.enum(ACTION_KINDS);

const stageActionSchema = z.enum([
  "submit_environment",
  "notify_world",
] satisfies readonly StageActionKind[]);
const worldActionSchema = z.enum(["notify_stage", "end_game"] satisfies readonly WorldActionKind[]);
const itemKindSchema = z.enum(["weapon", "equipment", "accessory", "consumable", "valuable"]);
/**
 * 六项属性共用一张表；未写出的字段补 0，运行时因此总是完整 Stats。
 * 其中只有 maxHp / damage / block 参与结算；strength / wisdom / agility（力量 / 智慧 / 敏捷）
 * 是保留的标准角色属性，当前没有任何读取点。
 */
const statsSchema = z.object({
  maxHp: z.number().default(0),
  strength: z.number().default(0),
  wisdom: z.number().default(0),
  agility: z.number().default(0),
  damage: z.number().default(0),
  block: z.number().default(0),
});

const itemEffectSchema = z.object({ type: z.string().min(1) }).passthrough();

const itemSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  kind: itemKindSchema,
  count: z.number().int().positive().optional(),
  stats: statsSchema.optional(),
  effect: itemEffectSchema,
  affixes: z.array(z.string()).optional(),
});

/** 槽位键只有四个；写错或用了旧键（body / head / feet / offhand）会直接报错，不静默丢弃。 */
const equipmentSchema = z.strictObject({
  weapon: z.string().optional(),
  armor: z.string().optional(),
  accessory1: z.string().optional(),
  accessory2: z.string().optional(),
});

const stageSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  profile: z.string(),
  environment: z.string(),
  items: z.array(itemSchema).optional(),
  actions: z.array(stageActionSchema),
});

const actorSchema = z.object({
  stageKey: z.string().min(1),
  name: z.string().min(1),
  profile: z.string(),
  openingBriefing: z.string().optional(),
  appearance: z.string().optional(),
  equipment: equipmentSchema.optional(),
  baseBody: z.object({
    race: z.string().min(1),
    description: z.string(),
  }),
  stats: statsSchema,
  hp: z.number().optional(),
  isDefaultPlayer: z.boolean().optional(),
  items: z.array(itemSchema),
  actions: z.array(actionKindSchema),
});

const worldSchema = z.object({
  contentVersion: z.string().min(1),
  contentKey: z.string().min(1),
  worldName: z.string().min(1),
  campaignSetting: z.string(),
  systemRules: z.string(),
  stages: z.array(stageSchema).min(1),
  connections: z.array(z.object({ from: z.string(), to: z.string() })),
  actors: z.array(actorSchema),
  actions: z.array(worldActionSchema),
});

/** 校验并收窄外部内容；CLI 的 --world-file 与 seed 都经过这里。 */
export function parseWorldContent(value: unknown): World {
  return worldSchema.parse(value) as World;
}
