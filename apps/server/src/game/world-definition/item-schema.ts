import { z } from "zod";
import {
  CARRIED_ACTION_KINDS,
  CARRIED_ACTIONS_BY_ITEM_KIND,
  carriedActionsForKind,
  isSlotActionKind,
  MULTI_TARGET_ACTION_KINDS,
  SLOT_ACTION_KINDS,
} from "../actions";
import { NAME_MARKER_PATTERN } from "../kernel/addressing";
import { triggerTargetsActor } from "../kernel/affixes";
import { statsSchema } from "../kernel/attributes";
import {
  type ActionKind,
  AFFIX_TRIGGERS,
  type AffixStatRef,
  type AffixTriggers,
  type DamageAmount,
  type ItemKind,
} from "../kernel/types";

/**
 * 道具定义的内容校验：只查这件道具自己的字段是否自洽。
 *
 * 需要看整张世界的规则（名字、文本泄漏、能力清单）在 `./invariants.ts`。
 */

/** 道具大类清单；`satisfies` 保证这里的每一项都在运行时 `ItemKind` 里。 */
const ITEM_KINDS = [
  "weapon",
  "equipment",
  "accessory",
  "consumable",
  "valuable",
  "material",
] satisfies readonly ItemKind[];

const itemKindSchema = z.enum(ITEM_KINDS);

/** 道具只能声明携带者动作：`use` 与 `fit` 各有别的出处，写进 `actions` 会被拒绝。 */
const affixActionKindSchema = z.enum(CARRIED_ACTION_KINDS satisfies readonly ActionKind[]);

/** 静态词缀能引用的数值全集：攻击力在结算期现算，道具终值取自本条道具。 */
const statRefValues = ["attack", "item.damage"] as const satisfies readonly AffixStatRef[];

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

/** 触发清单与类型同源：加一个触发只需要改 `AFFIX_TRIGGERS`。 */
const affixTriggersSchema = z
  .object(
    Object.fromEntries(AFFIX_TRIGGERS.map((trigger) => [trigger, affixListSchema.optional()])),
  )
  .strict() as unknown as z.ZodType<AffixTriggers>;

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
    const declared = item.actions ?? [];
    const heldInActions = declared.filter((kind) => !isSlotActionKind(kind));
    if (heldInActions.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: `${heldInActions.join("、")} 由 affixes.use 派生，不要写进 actions：持有这件道具的角色会自动获得它`,
        path: ["actions"],
      });
    }
    // 指不到角色的触发不能声明伤害：op 需要角色目标，写了也永远落不了地。
    for (const trigger of AFFIX_TRIGGERS) {
      if (triggerTargetsActor(trigger)) {
        continue;
      }
      const hasDamage = (item.affixes?.[trigger] ?? []).some((affix) =>
        (affix.ops ?? []).some((op) => op.kind === "damage"),
      );
      if (hasDamage) {
        ctx.addIssue({
          code: "custom",
          message: `affixes.${trigger} 只能声明 witness：它指不到角色，没有伤害目标`,
          path: ["affixes", trigger],
        });
      }
    }
    // 没登记的大类声明槽位动作一定是内容写错了，而不是“暂时不生效”。
    const grantable = carriedActionsForKind(item.kind);
    const unknown = declared.filter((kind) => isSlotActionKind(kind) && !grantable.includes(kind));
    if (unknown.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: `${item.kind} 不能声明动作 ${unknown.join("、")}；携带者只有 ${Object.keys(
          CARRIED_ACTIONS_BY_ITEM_KIND,
        ).join(" / ")}`,
        path: ["actions"],
      });
    }
    // 目标数是「这个动作能指向几个目标」的上限：不授予动作的道具没有可说的目标数。
    if (item.maxTargets !== undefined && declared.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "maxTargets 只对授予槽位动作的道具成立",
        path: ["maxTargets"],
      });
    }
    // 每个槽位动作都自带一套词缀：没有对应列表就会变成“能打但打不出伤害”。
    // 无条件是两回事：挥击与横扫各自声明，互不借用。
    for (const trigger of SLOT_ACTION_KINDS) {
      if (item.actions?.includes(trigger) && (item.affixes?.[trigger]?.length ?? 0) === 0) {
        ctx.addIssue({
          code: "custom",
          message: `声明 ${trigger} 的武器必须声明 affixes.${trigger}`,
          path: ["affixes", trigger],
        });
      }
    }
    // 上限与动作要互相成立：多目标动作至少容得下两个，没有多目标动作就不该有上限。
    const multiTarget = declared.filter((kind) =>
      (MULTI_TARGET_ACTION_KINDS as readonly ActionKind[]).includes(kind),
    );
    if (multiTarget.length > 0 && (item.maxTargets ?? 1) < 2) {
      ctx.addIssue({
        code: "custom",
        message: `声明 ${multiTarget.join("、")} 必须声明 maxTargets ≥ 2`,
        path: ["maxTargets"],
      });
    }
    if (multiTarget.length === 0 && (item.maxTargets ?? 1) > 1) {
      ctx.addIssue({
        code: "custom",
        message: "maxTargets > 1 需要同时声明多目标动作",
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
