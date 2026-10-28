import { z } from "zod";
import { ACTION_KINDS } from "./actions";
import type { StageActionKind, World, WorldActionKind } from "./types";

/** 十二个动作直接复用运行时清单，避免新增动作时漏改。 */
const actionKindSchema = z.enum(ACTION_KINDS);

const stageActionSchema = z.enum([
  "submit_environment",
  "notify_world",
  "open_passage",
] satisfies readonly StageActionKind[]);
const worldActionSchema = z.enum(["notify_stage", "end_game"] satisfies readonly WorldActionKind[]);
const itemKindSchema = z.enum([
  "weapon",
  "equipment",
  "accessory",
  "consumable",
  "valuable",
  "material",
]);
/**
 * 未写出的字段补 0，运行时总是完整 Stats。
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

const affixSchema = z.object({
  name: z.string().min(1),
  content: z.string().min(1),
});

const itemSchema = z
  .object({
    key: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    kind: itemKindSchema,
    count: z.number().int().positive().optional(),
    stats: statsSchema.optional(),
    effect: itemEffectSchema,
    affixes: z.array(affixSchema).optional(),
    source: z.string().min(1).optional(),
  })
  .superRefine((item, ctx) => {
    if (item.source !== undefined && item.kind !== "material") {
      ctx.addIssue({ code: "custom", message: "只有 material 可以声明 source", path: ["source"] });
    }
  });

/** 槽位键固定为 weapon / armor / accessory；写错会直接报错，不静默丢弃。 */
const equipmentSchema = z.strictObject({
  weapon: z.string().optional(),
  armor: z.string().optional(),
  accessory: z.string().optional(),
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
  key: z.string().min(1),
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

const worldSchema = z
  .object({
    contentVersion: z.string().min(1),
    contentKey: z.string().min(1),
    worldName: z.string().min(1),
    profile: z.string().min(1),
    campaignSetting: z.string(),
    systemRules: z.string(),
    stages: z.array(stageSchema).min(1),
    connections: z.array(
      z.object({
        from: z.string(),
        to: z.string(),
        passage: z.enum(["open", "sealed"]).optional(),
      }),
    ),
    actors: z.array(actorSchema),
    knownIdentities: z
      .array(
        z.object({
          observer: z.string().min(1),
          subject: z.string().min(1),
          name: z.string().min(1),
        }),
      )
      .optional(),
    actions: z.array(worldActionSchema),
  })
  .superRefine((value, ctx) => {
    value.stages.forEach((stage, index) => {
      if (!stage.actions.includes("submit_environment")) {
        ctx.addIssue({
          code: "custom",
          message: "每个场景都必须声明 submit_environment",
          path: ["stages", index, "actions"],
        });
      }
    });
  });

/** 校验并收窄外部内容；CLI 的 --world-file 与 seed 都经过这里。 */
export function parseWorldContent(value: unknown): World {
  return worldSchema.parse(value) as World;
}
