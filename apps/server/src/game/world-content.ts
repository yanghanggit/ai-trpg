import { z } from "zod";
import type { World } from "./types";

const actorCapabilitySchema = z.enum([
  "say",
  "whisper",
  "announce",
  "move",
  "wait",
  "attack",
  "steal",
  "give",
  "pickup",
  "use",
  "query",
]);

const stageActionSchema = z.enum(["submit_environment", "notify_world"]);
const worldActionSchema = z.enum(["notify_stage", "end_game"]);
const itemKindSchema = z.enum(["weapon", "equipment", "accessory", "consumable", "valuable"]);
const itemStatsSchema = z.object({
  damage: z.number().optional(),
  block: z.number().optional(),
});

const itemEffectSchema = z.object({ type: z.string().min(1) }).passthrough();

const itemSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  kind: itemKindSchema,
  count: z.number().int().positive().optional(),
  stats: itemStatsSchema.optional(),
  effect: itemEffectSchema,
  affixes: z.array(z.string()).optional(),
});

const equipmentSchema = z.object({
  weapon: z.string().optional(),
  offhand: z.string().optional(),
  head: z.string().optional(),
  body: z.string().optional(),
  feet: z.string().optional(),
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

const actorStatsSchema = z.object({
  hp: z.number(),
  maxHp: z.number(),
  attack: z.number(),
  defense: z.number(),
  speed: z.number(),
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
  stats: actorStatsSchema,
  status: z.enum(["alive", "dead"]).optional(),
  isDefaultPlayer: z.boolean().optional(),
  items: z.array(itemSchema),
  actions: z.array(actorCapabilitySchema),
});

const worldSchema = z.object({
  contentVersion: z.string().min(1),
  worldName: z.string().min(1),
  campaignSetting: z.string(),
  systemRules: z.string(),
  initialNarration: z.string().optional(),
  initialStageKey: z.string().optional(),
  stages: z.array(stageSchema).min(1),
  connections: z.array(z.object({ from: z.string(), to: z.string() })),
  actors: z.array(actorSchema),
  actions: z.array(worldActionSchema),
});

/** 校验并收窄外部内容；CLI 的 --world-file 与 seed 都经过这里。 */
export function parseWorldContent(value: unknown): World {
  return worldSchema.parse(value) as World;
}
