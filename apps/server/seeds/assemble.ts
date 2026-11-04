import type { WorldFunctionProfiles } from "../src/game/types";
import type { World } from "../src/game/world-definition";
import { GLOBAL_RULES } from "./system-rules";

/**
 * 战役级、跨剧本不变的内容。
 *
 * 世界观给题材与边界；世界职能口径给这个题材下各项职能的规矩与口味。
 */
export type Campaign = {
  campaignSetting: string;
  worldFunctions: WorldFunctionProfiles;
};

/**
 * 一个剧本 = 战役下的一个故事切片。
 *
 * 它**不能**写 `campaignSetting` / `globalRules`：前者只来自战役文件，后者是
 * 所有战役共用的框架文本，由 `assembleWorld()` 统一补上。`worldFunctions` 默认
 * 继承战役口径，剧本只在这一个切片确实不同的时候按条覆盖。
 */
export type Script = Omit<World, "campaignSetting" | "globalRules" | "worldFunctions"> & {
  worldFunctions?: Partial<WorldFunctionProfiles>;
};

/** 把战役内容套到剧本上，得到运行时使用的 World；剧本是唯一的变化点。 */
export function assembleWorld(campaign: Campaign, script: Script): World {
  const { worldFunctions: overrides, ...rest } = script;
  return {
    ...rest,
    campaignSetting: campaign.campaignSetting,
    globalRules: GLOBAL_RULES,
    worldFunctions: { ...campaign.worldFunctions, ...overrides },
  };
}
