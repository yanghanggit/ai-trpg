import type { WorldFunctionType } from "../../../src/game/types";

/**
 * 一个世界职能 agent 的全部文本。
 *
 * 口径、职责与不可协商的约束放在同一个文件里：它们本来就描述同一件事——这个
 * agent 是谁、要产出什么、不能越过什么。拆开只会让同一个 agent 的规则散落在两处。
 */
export type WorldFunctionAgentSpec = {
  fn: WorldFunctionType;
  /** 中文名，只用于提示词。 */
  label: string;
  /** 职责：产出什么。不写工具名、参数与读取顺序。 */
  duty: string;
  /** 口径：这件事在这个世界里怎么判、写到什么尺度、哪些专名要保住。 */
  profile: string;
  /** 不可协商的约束：说错了会真的出错的边界。能被 schema 或守卫强制的，不在这里复述。 */
  constraints?: string;
};
