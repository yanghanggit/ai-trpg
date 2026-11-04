import type { World } from "../src/game/types";
import { GLOBAL_RULES } from "./system-rules";

/**
 * 一个剧本 = 战役下的一个故事切片。
 *
 * 它**不能**写 `campaignSetting` / `globalRules`：前者只来自战役文件，后者是
 * 所有战役共用的框架文本，由 `assembleWorld()` 统一补上，所以“不可变”是类型
 * 层面的，而不是靠约定。
 */
export type Script = Omit<World, "campaignSetting" | "globalRules">;

/** 把世界观与全局规则套到剧本上，得到运行时使用的 World；剧本是唯一的变化点。 */
export function assembleWorld(campaignSetting: string, script: Script): World {
  return { campaignSetting, globalRules: GLOBAL_RULES, ...script };
}
