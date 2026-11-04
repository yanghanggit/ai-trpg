import { z } from "zod";
import { statsSchema } from "./attributes";
import type { ActionKind, ItemKind } from "./types";

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
const itemEffectSchema = z.object({ type: z.string().min(1) }).passthrough();

const affixSchema = z.object({
  name: z.string().min(1),
  content: z.string().min(1),
});

const itemActionKindSchema = z.enum(["strike"] satisfies readonly ActionKind[]);

export const itemSchema = z
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
export const equipmentSchema = z.strictObject({
  weapon: z.string().optional(),
  armor: z.string().optional(),
  accessory: z.string().optional(),
});
