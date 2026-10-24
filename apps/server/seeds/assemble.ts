import type { World } from "../src/game/types";

/** 战役级、跨剧本不变的文本；只有 system prompt 性质的内容，没有状态。 */
export type Campaign = {
  campaignSetting: string;
  systemRules: string;
};

/**
 * 一个剧本 = 战役下的一个故事切片。
 *
 * 它**不能**写 `campaignSetting` / `systemRules`：这两段只来自战役文件，
 * 由 `assembleWorld()` 统一补上，所以“不可变”是类型层面的，而不是靠约定。
 */
export type Script = Omit<World, "campaignSetting" | "systemRules">;

/** 把战役文本套到剧本上，得到运行时使用的 World；剧本是唯一的变化点。 */
export function assembleWorld(campaign: Campaign, script: Script): World {
  return { ...campaign, ...script };
}
