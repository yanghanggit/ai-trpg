import { assembleWorld } from "../assemble";
import { BELL_MONASTERY } from "./bell-monastery";
import { DARK_FANTASY_SETTING } from "./campaign";
import { CROW_GRAVE } from "./crow-grave";

/**
 * 「黑暗奇幻」战役的两个剧本：枯钟修道院与鸦葬岗。
 *
 * 战役设定来自 `./campaign`、全局规则来自 `../global-rules`、世界职能 agent 的
 * 文本在 `./agents/`；剧本提供场景、角色、连接，以及构建时定档的 agent 宪法。
 * 知识库与剧本 1:1 绑定。黑疖病是战役层共享设定。
 */
export const BELL_MONASTERY_WORLD = assembleWorld(
  { campaignSetting: DARK_FANTASY_SETTING },
  BELL_MONASTERY,
);
export const CROW_GRAVE_WORLD = assembleWorld(
  { campaignSetting: DARK_FANTASY_SETTING },
  CROW_GRAVE,
);
export { BELL_MONASTERY_KNOWLEDGE } from "./bell-monastery.knowledge";
export { CROW_GRAVE_KNOWLEDGE } from "./crow-grave.knowledge";
