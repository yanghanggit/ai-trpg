import { z } from "zod";
import { INNATE_ACTION_KINDS } from "../actions";
import { isValidForm } from "../agents/appearance/form";
import { NAME_MARKER_PATTERN } from "../kernel/addressing";
import { statsSchema } from "../kernel/attributes";
import { MAX_STAGE_ANCHORS } from "../kernel/limits";
import type { StageActionKind, WorldActionKind, WorldFunction } from "../kernel/types";
import { FUNCTION_PROMPT_VARIANTS, WORLD_FUNCTION_TYPES } from "../kernel/types";
import { equipmentSchema, itemSchema } from "./item-schema";

/**
 * 世界内容的 zod 形状：场景、角色、连接与世界本身。
 *
 * 只描述「单看一个实体就能判」的约束。要看整张世界图才能判的规则在 `invariants.ts`，
 * 两者由 `index.ts` 串成一次解析。
 */

/**
 * 角色只能声明固有动作；携带者动作（`strike` / `cleave`）由物品授予，
 * 写进 `actor.actions` 会在建局前被拒，而不是等回合里失败。
 */
const actionKindSchema = z.enum(INNATE_ACTION_KINDS);

const stageActionSchema = z.enum([
  "submit_environment",
  "notify_world",
  "open_passage",
  "add_anchor",
  "remove_anchor",
  "update_anchor",
] satisfies readonly StageActionKind[]);
const worldActionSchema = z.enum(["notify_stage", "end_game"] satisfies readonly WorldActionKind[]);
/** 内容层给开局关系指定的当前称呼；必须显式写出，不接受隐藏的真名默认值。 */
const signatureNameSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => !NAME_MARKER_PATTERN.test(value) && !/\p{Cc}/u.test(value),
    "名字不能包含 # 或控制字符",
  );

const worldVisitedStageSchema = z.strictObject({
  actor: z.string().min(1),
  stage: z.string().min(1),
});

const worldSignatureNameSchema = z.strictObject({
  observer: z.string().min(1),
  subject: z.string().min(1),
  name: signatureNameSchema,
});

const stageAnchorSchema = z
  .object({
    key: z.string().trim().min(1),
    label: z.string().trim().min(1),
    description: z.string().trim().optional(),
    items: z.array(itemSchema).optional(),
  })
  .strict();

const stageSchema = z
  .object({
    key: z.string().min(1),
    name: z.string().min(1),
    profile: z.string(),
    environment: z.string(),
    anchors: z.array(stageAnchorSchema).max(MAX_STAGE_ANCHORS).optional(),
    actions: z.array(stageActionSchema),
    teleportBlocked: z.boolean().optional(),
  })
  .strict();

/**
 * 技艺：把几个动作捆在一个名字下的内容单元。
 *
 * 动作只能是没有携带者的固有动作——`strike` / `cleave` 由武器借出，不能写进技艺。
 */
const skillSchema = z
  .object({
    key: z.string().trim().min(1),
    name: z.string().trim().min(1),
    description: z.string().trim().min(1),
    actions: z.array(actionKindSchema).min(1),
  })
  .strict();

const actorSchema = z.object({
  key: z.string().min(1),
  stageKey: z.string().min(1),
  name: z.string().min(1),
  profile: z.string(),
  openingBriefing: z.string().optional(),
  equipment: equipmentSchema.optional(),
  signature: z.object({
    /** 稳定形态，统一写成 `种族:描述`；它是辨认与外观推理的输入。 */
    form: z.string().refine(isValidForm, "form 必须写成 种族:描述"),
    /** 预制外观快照；省略时回退到 form。 */
    appearance: z.string().optional(),
  }),
  stats: statsSchema,
  hp: z.number().optional(),
  isDefaultPlayer: z.boolean().optional(),
  inventory: z.array(itemSchema),
  /** 该角色出身带来的知识标签；空/缺省 = 只读无门槛知识。 */
  knowledgeAccess: z
    .array(z.string().trim().min(1))
    .refine((tags) => new Set(tags).size === tags.length, "knowledgeAccess 不能重复")
    .optional(),
  proficiencies: z.array(skillSchema).optional(),
  actions: z.array(actionKindSchema),
});

export const worldSchema = z.object({
  contentVersion: z.string().min(1),
  contentKey: z.string().min(1),
  worldName: z.string().min(1),
  profile: z.string().min(1),
  campaignSetting: z.string(),
  globalRules: z.string(),
  /**
   * 世界职能宪法：内容层在剧本构建时定档，每个职能恰好一段；缺一个就是解析失败。
   * 细分键（`compact.<主体>`）可选，不写就回落到该职能的主宪法。
   */
  functionPrompts: z.object({
    ...(Object.fromEntries(WORLD_FUNCTION_TYPES.map((fn) => [fn, z.string().min(1)])) as {
      [K in WorldFunction]: z.ZodString;
    }),
    ...(Object.fromEntries(
      FUNCTION_PROMPT_VARIANTS.map((key) => [key, z.string().min(1).optional()]),
    ) as { [K in (typeof FUNCTION_PROMPT_VARIANTS)[number]]: z.ZodOptional<z.ZodString> }),
  }),
  stages: z.array(stageSchema).min(1),
  connections: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      passage: z.enum(["open", "sealed"]).optional(),
    }),
  ),
  actors: z.array(actorSchema),
  signatureNames: z.array(worldSignatureNameSchema).optional(),
  visitedStages: z.array(worldVisitedStageSchema).optional(),
  actions: z.array(worldActionSchema),
});
