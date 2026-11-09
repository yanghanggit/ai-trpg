import { z } from "zod";
import {
  CARRIED_ACTION_KINDS,
  CARRIED_ACTIONS_BY_ITEM_KIND,
  carriedActionsForKind,
} from "./actions";
import { statsSchema } from "./attributes";
import { NAME_MARKER_PATTERN } from "./reference";
import type { ActionKind, AffixStatRef, DamageAmount, ItemKind } from "./types";

/**
 * 物品定义的内容校验：只查这件物品自己的字段是否自洽。
 *
 * 需要看整张世界的规则（名字、文本泄漏、能力清单）在 `world-definition/invariants.ts`。
 */

/** 物品大类清单；`satisfies` 保证这里的每一项都在运行时 `ItemKind` 里。 */
const ITEM_KINDS = [
  "weapon",
  "equipment",
  "accessory",
  "consumable",
  "valuable",
  "material",
] satisfies readonly ItemKind[];

const itemKindSchema = z.enum(ITEM_KINDS);

/** 物品只能声明携带者动作；固有动作不属于任何物品。 */
const affixActionKindSchema = z.enum(CARRIED_ACTION_KINDS satisfies readonly ActionKind[]);

/** 静态词缀能引用的属性全集；结算时从当前 actor / item 行读取。 */
const statRefValues = [
  "attack",
  "actor.damage",
  "item.damage",
] as const satisfies readonly AffixStatRef[];

const statRefSchema = z.enum(statRefValues);

const damageAmountSchema: z.ZodType<DamageAmount> = z.union([
  z.number().int(),
  z.strictObject({ ref: statRefSchema, factor: z.number().optional() }),
]);

/** 见证模板只允许固定占位符；名字、编号与系统引用由运行时守卫拦截。 */
const WITNESS_PLACEHOLDERS = ["source", "target", "anchor", "item"] as const;
const PLACEHOLDER_PATTERN = /\{(source|target|anchor|item)\}/g;

export function hasOnlyKnownPlaceholders(template: string): boolean {
  const stripped = template.replace(PLACEHOLDER_PATTERN, "");
  return !stripped.includes("{") && !stripped.includes("}");
}

const witnessTemplateSchema = z
  .string()
  .min(1)
  .refine(hasOnlyKnownPlaceholders, `见证模板只允许占位符 ${WITNESS_PLACEHOLDERS.join(" / ")}`)
  .refine((template) => !NAME_MARKER_PATTERN.test(template), "见证模板不能包含 # 标记");

const affixOpSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("damage"), amount: damageAmountSchema }),
  z.strictObject({
    kind: z.literal("witness"),
    template: witnessTemplateSchema,
    visibility: z.enum(["stage", "target"]).optional(),
  }),
]);

const affixModeSchema = z.enum(["static", "agent"]);

const affixDefinitionSchema = z
  .object({
    name: z.string().min(1),
    content: z.string().min(1),
    mode: affixModeSchema.optional(),
    ops: z.array(affixOpSchema).optional(),
  })
  .strict()
  .superRefine((affix, ctx) => {
    const mode = affix.mode ?? "static";
    // 静态词缀必须给出可执行的 op；agent 词缀的效果由工具决定，带 ops 一定是写错了。
    if (mode === "static" && (affix.ops?.length ?? 0) === 0) {
      ctx.addIssue({ code: "custom", message: "static 词缀必须至少声明一个 op", path: ["ops"] });
    }
    if (mode === "agent" && affix.ops !== undefined) {
      ctx.addIssue({ code: "custom", message: "agent 词缀不能声明 ops", path: ["ops"] });
    }
    if (mode === "static") {
      // content 只做展示与 prompt 渲染：引用的属性必须能被结算侧解析。
      const allowed = new Set<string>(statRefValues);
      allowed.add("item.name");
      for (const match of affix.content.matchAll(/\{\{([^}]+)\}\}/g)) {
        const token = match[1]?.trim() ?? "";
        if (!allowed.has(token)) {
          ctx.addIssue({
            code: "custom",
            message: `词缀文本引用了未知属性: ${token}`,
            path: ["content"],
          });
        }
      }
    }
  });

const affixListSchema = z.array(affixDefinitionSchema);

const affixTriggersSchema = z
  .object({
    strike: affixListSchema.optional(),
    cleave: affixListSchema.optional(),
    use: affixListSchema.optional(),
  })
  .strict();

export const itemSchema = z
  .object({
    key: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    kind: itemKindSchema,
    count: z.number().int().positive().optional(),
    stats: statsSchema.optional(),
    /** `cleave` 一次最多命中的目标数；只有武器可声明，省略时物化为 1。 */
    maxTargets: z.number().int().min(1).optional(),
    affixes: affixTriggersSchema.optional(),
    actions: z.array(affixActionKindSchema).optional(),
    source: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((item, ctx) => {
    if (item.source !== undefined && item.kind !== "material") {
      ctx.addIssue({ code: "custom", message: "只有 material 可以声明 source", path: ["source"] });
    }
    // 动作挂在携带者上，哪些大类能携带由 `CARRIED_ACTIONS_BY_ITEM_KIND` 决定；
    // 没登记的物品类声明动作一定是内容写错了，而不是“暂时不生效”。
    const grantable = carriedActionsForKind(item.kind);
    const unknown = (item.actions ?? []).filter((kind) => !grantable.includes(kind));
    if (unknown.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: `${item.kind} 不能声明动作 ${unknown.join("、")}；携带者只有 ${Object.keys(
          CARRIED_ACTIONS_BY_ITEM_KIND,
        ).join(" / ")}`,
        path: ["actions"],
      });
    }
    // 目标数是武器挥击的属性，不是可穿戴物的通用属性。
    if (item.maxTargets !== undefined && item.kind !== "weapon") {
      ctx.addIssue({
        code: "custom",
        message: "只有 weapon 可以声明 maxTargets",
        path: ["maxTargets"],
      });
    }
    // 每个攻击动作都自带一套词缀：没有对应列表就会变成“能打但打不出伤害”。
    // 无条件是两回事：挥击与横扫各自声明，互不借用。
    for (const trigger of CARRIED_ACTION_KINDS) {
      if (item.actions?.includes(trigger) && (item.affixes?.[trigger]?.length ?? 0) === 0) {
        ctx.addIssue({
          code: "custom",
          message: `声明 ${trigger} 的武器必须声明 affixes.${trigger}`,
          path: ["affixes", trigger],
        });
      }
    }
    // 单体挥击用 strike；cleave 至少两个目标才有意义，上限也必须真的容得下两个。
    if (item.actions?.includes("cleave") && (item.maxTargets ?? 1) < 2) {
      ctx.addIssue({
        code: "custom",
        message: "声明 cleave 的武器必须声明 maxTargets ≥ 2",
        path: ["maxTargets"],
      });
    }
    // 没有 cleave 的武器写多目标上限只会误导内容作者：strike 永远是单体。
    if (!item.actions?.includes("cleave") && (item.maxTargets ?? 1) > 1) {
      ctx.addIssue({
        code: "custom",
        message: "maxTargets > 1 需要同时声明 cleave",
        path: ["maxTargets"],
      });
    }
  });

/** 槽位键固定为 weapon / armor / accessory；写错会直接报错，不静默丢弃。 */
export const equipmentSchema = z.strictObject({
  weapon: z.string().optional(),
  armor: z.string().optional(),
  accessory: z.string().optional(),
});
