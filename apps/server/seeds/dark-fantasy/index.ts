import { assembleWorld } from "../assemble";
import { BELL_MONASTERY } from "./bell-monastery";
import { DARK_FANTASY_SETTING } from "./campaign";

/**
 * 「黑暗奇幻」战役当前唯一的剧本：枯钟修道院。
 *
 * 战役设定来自 `./campaign`、全局规则来自 `../global-rules`、世界职能 agent 的
 * 文本在 `./agents/`；剧本提供场景、角色、连接，以及构建时定档的 agent 宪法。
 * 知识库与剧本 1:1 绑定。
 */
export const BELL_MONASTERY_WORLD = assembleWorld(
  { campaignSetting: DARK_FANTASY_SETTING },
  BELL_MONASTERY,
);
export { BELL_MONASTERY_KNOWLEDGE } from "./bell-monastery.knowledge";
