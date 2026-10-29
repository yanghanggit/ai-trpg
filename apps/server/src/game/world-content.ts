import { z } from "zod";
import { ACTION_KINDS } from "./actions";
import { ENTITY_PREFIX, type EntityKind, splitEntityName } from "./entity-name";
import { findTextLeaks } from "./text-guard";
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

const itemActionKindSchema = z.enum(["strike"]);

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
    actions: z.array(itemActionKindSchema).optional(),
    source: z.string().min(1).optional(),
  })
  .superRefine((item, ctx) => {
    if (item.source !== undefined && item.kind !== "material") {
      ctx.addIssue({ code: "custom", message: "只有 material 可以声明 source", path: ["source"] });
    }
    // 动作挂在物品上，但只有武器能借给角色出手；其它大类声明动作一定是内容写错了。
    if (item.actions !== undefined && item.actions.length > 0 && item.kind !== "weapon") {
      ctx.addIssue({ code: "custom", message: "只有 weapon 可以声明 actions", path: ["actions"] });
    }
    // strike 的伤害来自 effect，两者脱节就会变成“能挥击但打不出伤害”。
    if (item.actions?.includes("strike") && item.effect.type !== "damage") {
      ctx.addIssue({
        code: "custom",
        message: "声明 strike 的武器必须声明 damage 效果",
        path: ["actions"],
      });
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
  teleportBlocked: z.boolean().optional(),
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
    // 类型前缀是系统词汇：一旦写了前缀，就必须与这个位置的代码类型一致。
    // 不带前缀的写法只允许作为测试夹具或过渡内容的逃生口，正式 seed 由 seed 守卫拒绝。
    checkEntityName(value.worldName, "world", ["worldName"], ctx);
    const actorNames = value.actors.map((actor) => actor.name);
    value.stages.forEach((stage, index) => {
      checkEntityName(stage.name, "stage", ["stages", index, "name"], ctx);
      stage.items?.forEach((item, itemIndex) => {
        checkEntityName(item.name, item.kind, ["stages", index, "items", itemIndex, "name"], ctx);
      });
      const leaks = findTextLeaks(stage.environment, actorNames);
      if (leaks.length > 0) {
        ctx.addIssue({
          code: "custom",
          message: `environment 不能包含角色名、系统指代或规范名: ${leaks
            .map((leak) => leak.token)
            .join("、")}`,
          path: ["stages", index, "environment"],
        });
      }
      if (!stage.actions.includes("submit_environment")) {
        ctx.addIssue({
          code: "custom",
          message: "每个场景都必须声明 submit_environment",
          path: ["stages", index, "actions"],
        });
      }
    });
    value.actors.forEach((actor, index) => {
      checkEntityName(actor.name, "actor", ["actors", index, "name"], ctx);
      actor.items.forEach((item, itemIndex) => {
        checkEntityName(item.name, item.kind, ["actors", index, "items", itemIndex, "name"], ctx);
      });
    });
  });

/**
 * 名称前缀校验。
 *
 * 允许完全不带前缀（测试夹具 / 过渡内容）；只要出现前缀，就必须是这一位置对应的
 * 系统词汇，物品前缀还必须与 `kind` 一致。
 */
function checkEntityName(
  raw: string,
  expected: EntityKind,
  path: (string | number)[],
  ctx: z.RefinementCtx,
): void {
  const parsed = splitEntityName(raw);
  if (parsed.prefix === "" && parsed.kind === null) {
    return;
  }
  const expectedPrefix = ENTITY_PREFIX[expected];
  if (parsed.prefix !== expectedPrefix) {
    ctx.addIssue({
      code: "custom",
      message: `名称前缀必须是 ${expectedPrefix}.，实际是 ${parsed.prefix}.`,
      path,
    });
  }
}

/** 校验并收窄外部内容；CLI 的 --world-file 与 seed 都经过这里。 */
export function parseWorldContent(value: unknown): World {
  return worldSchema.parse(value) as World;
}
