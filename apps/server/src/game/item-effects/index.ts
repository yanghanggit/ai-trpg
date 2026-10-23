import { GameError } from "../errors";
import type { ItemEffect } from "../types";
import { applyDamageEffect } from "./damage";
import { applyEventEffect } from "./event";
import type { ItemEffectContext, ItemEffectHandler } from "./types";

/** 空手攻击使用的系统效果；不依赖任何物品行。 */
export const UNARMED_EFFECT: ItemEffect = { type: "damage" };

/** effect.type → handler；新增效果只注册这里。 */
const EFFECT_HANDLERS: Record<string, ItemEffectHandler> = {
  event: applyEventEffect,
  damage: applyDamageEffect,
};

/** 动作层唯一的效果入口：按 effect.type 路由到 handler。 */
export async function applyItemEffect(context: ItemEffectContext): Promise<string> {
  const handler = EFFECT_HANDLERS[context.effect.type];
  if (!handler) {
    throw new GameError("invalid_action", `未知物品效果: ${context.effect.type}`);
  }
  return handler(context);
}

export type { ItemEffectContext, ItemEffectHandler } from "./types";
