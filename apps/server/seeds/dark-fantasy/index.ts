import { assembleWorld } from "../assemble";
import { BELL_MONASTERY } from "./bell-monastery";
import { DARK_FANTASY_SETTING } from "./campaign";
import { DARK_FANTASY_FUNCTIONS } from "./functions";

/**
 * 「黑暗奇幻」战役当前唯一的剧本：枯钟修道院。
 *
 * 战役设定来自 `./campaign`、世界职能口径来自 `./functions`、全局规则来自
 * `../system-rules`；剧本只提供场景、角色与连接，知识库与剧本 1:1 绑定。
 */
export const BELL_MONASTERY_WORLD = assembleWorld(
  { campaignSetting: DARK_FANTASY_SETTING, worldFunctions: DARK_FANTASY_FUNCTIONS },
  BELL_MONASTERY,
);
export { BELL_MONASTERY_KNOWLEDGE } from "./bell-monastery.knowledge";
