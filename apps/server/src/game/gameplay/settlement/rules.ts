import { GAMEPLAY_RULES, type GameplayRules } from "../rules";
import type { ResolvedRules } from "./types";

/**
 * 规则解析：把模块级开关表解析成一份**冻结的完整配置**。
 *
 * 这是 `ResolvedRules` 的唯一生产者。结算期不许再读 `GAMEPLAY_RULES`，
 * 否则「块内自包含」就退化成「块里存了个引用」，回放会跟着当前常量漂移。
 *
 * 默认参数为 0 等于「规则存在但未启用」：不引入额外开关，数值本身就是开关。
 */
const DEFAULT_PARAMS: ResolvedRules["params"] = { lifestealRate: 0 };

export function resolveRules(overrides?: {
  switches?: Partial<GameplayRules>;
  params?: Partial<ResolvedRules["params"]>;
}): ResolvedRules {
  const switches: GameplayRules = { ...GAMEPLAY_RULES, ...(overrides?.switches ?? {}) };
  const params: ResolvedRules["params"] = { ...DEFAULT_PARAMS, ...(overrides?.params ?? {}) };
  return { switches, params };
}
