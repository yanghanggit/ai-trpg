import { z } from "zod";
import { statsSchema } from "./attributes";
import { NAME_MARKER_PATTERN } from "./reference";
import type { ActionKind, AffixStatRef, DamageAmount, ItemKind } from "./types";

/**
 * 物品定义的内容校验：只查这件物品自己的字段是否自洽。
 *
 * 需要看整张世界的规则（名字、文本泄漏、能力清单）在 `world-invariants.ts`。
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

const affixActionKindSchema = z.enum(["strike"] satisfies readonly ActionKind[]);

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
  .refine((template) => !NAME_MARKER_PATTERN.test(template), "见证模板不能包含 @ 或 # 标记");

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
    affixes: affixTriggersSchema.optional(),
    actions: z.array(affixActionKindSchema).optional(),
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
    // strike 的伤害来自静态词缀：没有 strike 列表就会变成“能挥击但打不出伤害”。
    if (item.actions?.includes("strike") && (item.affixes?.strike?.length ?? 0) === 0) {
      ctx.addIssue({
        code: "custom",
        message: "声明 strike 的武器必须声明 affixes.strike",
        path: ["affixes", "strike"],
      });
    }
  });

/** 槽位键固定为 weapon / armor / accessory；写错会直接报错，不静默丢弃。 */
export const equipmentSchema = z.strictObject({
  weapon: z.string().optional(),
  armor: z.string().optional(),
  accessory: z.string().optional(),
});
