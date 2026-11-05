import { z } from "zod";
import { ACTION_KINDS } from "./actions";
import { statsSchema } from "./attributes";
import { MAX_STAGE_ANCHORS } from "./constants";
import { isValidForm } from "./form";
import { equipmentSchema, itemSchema } from "./item-schema";
import { NAME_MARKER_PATTERN } from "./reference";
import type { StageActionKind, WorldActionKind } from "./types";
import { WORLD_FUNCTION_TYPES } from "./types";

/**
 * 世界定义的内容校验形状：场景、角色、连接与世界本身。
 *
 * 只描述形状；需要整张图的规则在 `world-invariants.ts`，入口在 `parse-world-content.ts`。
 */

/** 十二个动作直接复用运行时清单，避免新增动作时漏改。 */
const actionKindSchema = z.enum(ACTION_KINDS);

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
    "名字不能包含 @、# 或控制字符",
  );

const worldKnownStageSchema = z.strictObject({
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
  items: z.array(itemSchema),
  actions: z.array(actionKindSchema),
});

export const worldSchema = z.object({
  contentVersion: z.string().min(1),
  contentKey: z.string().min(1),
  worldName: z.string().min(1),
  profile: z.string().min(1),
  campaignSetting: z.string(),
  globalRules: z.string(),
  /** 世界职能 agent：内容层在剧本构建时逐个定档，框架只校验不代劳。 */
  functionAgents: z.array(
    z.object({
      fn: z.enum(WORLD_FUNCTION_TYPES),
      systemPrompt: z.string().min(1),
    }),
  ),
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
  knownStages: z.array(worldKnownStageSchema).optional(),
  actions: z.array(worldActionSchema),
});
