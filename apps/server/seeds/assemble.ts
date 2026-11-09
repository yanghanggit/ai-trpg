import type { World } from "../src/game/world-definition";
import { GLOBAL_RULES } from "./global-rules";

/**
 * 战役级、跨剧本不变的内容。
 *
 * 世界观给题材与边界；世界职能 agent 的文本在 `dark-fantasy/agents/` 下。
 */
export type Campaign = {
  campaignSetting: string;
};

/**
 * 一个剧本 = 战役下的一个故事切片。
 *
 * 它**不能**写 `campaignSetting` / `globalRules`：前者只来自战役文件，后者是所有
 * 战役共用的框架文本，由 `assembleWorld()` 统一补上。
 *
 * 世界职能的宪法由剧本自己给出——每个职能在剧本构建时定档，框架不代劳装配。
 */
export type Script = Omit<World, "campaignSetting" | "globalRules">;

/** 把战役内容套到剧本上，得到运行时使用的 World；剧本是唯一的变化点。 */
export function assembleWorld(campaign: Campaign, script: Script): World {
  return {
    ...script,
    campaignSetting: campaign.campaignSetting,
    globalRules: GLOBAL_RULES,
  };
}
