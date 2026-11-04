import { assembleWorld } from "../assemble";
import { BELL_MONASTERY } from "./bell-monastery";
import { DARK_FANTASY_SETTING } from "./campaign";

/**
 * 「黑暗奇幻」战役当前唯一的剧本：枯钟修道院。
 *
 * 战役设定是 `./campaign` 的一个字符串，全局规则来自 `../system-rules`，剧本只提供
 * 场景、角色与连接；知识库与剧本 1:1 绑定，跟着剧本文件走。
 */
export const BELL_MONASTERY_WORLD = assembleWorld(DARK_FANTASY_SETTING, BELL_MONASTERY);
export { BELL_MONASTERY_KNOWLEDGE } from "./bell-monastery.knowledge";
