import { GameError } from "../errors";
import { applyDamageEffect } from "./damage";
import { applyEventEffect } from "./event";
import type { ItemEffectContext, ItemEffectHandler } from "./types";

/** effect.type → handler；新增效果只注册这里。 */
const EFFECT_HANDLERS: Record<string, ItemEffectHandler> = {
  event: applyEventEffect,
  damage: applyDamageEffect,
};

/** 只有注册了 handler 的物品能被 `use`；材料之类的惰性物品用 `none`。 */
export function hasItemEffectHandler(type: string): boolean {
  return EFFECT_HANDLERS[type] !== undefined;
}

/** 动作层唯一的效果入口：只执行默认 effect；affixes 由后续 agent 补执行。 */
export async function applyItemEffect(context: ItemEffectContext): Promise<string> {
  const handler = EFFECT_HANDLERS[context.effect.type];
  if (!handler) {
    throw new GameError(
      "invalid_action",
      `物品没有可以直接使用的效果: ${context.item?.name ?? "该物品"}`,
    );
  }
  return handler(context);
}

export type {
  AffixAgentOptions,
  AffixRequest,
  ItemEffectContext,
  ItemEffectHandler,
} from "./types";
