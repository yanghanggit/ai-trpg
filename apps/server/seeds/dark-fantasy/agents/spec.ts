import type { WorldFunction } from "../../../src/game/types";

/**
 * 一个世界职能的全部文本；职能名就是它在 `WORLD_FUNCTIONS` 里的键。
 *
 * 口径、职责与不可协商的约束放在同一个文件里：它们本来就描述同一件事——这个
 * 职能是谁、要产出什么、不能越过什么。拆开只会让同一个职能的规则散落在两处。
 */
export type WorldFunctionSpec = {
  /** 中文名，只用于提示词。 */
  label: string;
  /** 职责：产出什么。不写工具名、参数与读取顺序。 */
  duty: string;
  /** 口径：这件事在这个世界里怎么判、写到什么尺度、哪些专名要保住。 */
  profile: string;
  /** 不可协商的约束：说错了会真的出错的边界。能被 schema 或守卫强制的，不在这里复述。 */
  constraints?: string;
};

/** 职能名到它的文本；缺一个职能就是编译错误，不用等到运行时才发现。 */
export type WorldFunctions = Record<WorldFunction, WorldFunctionSpec>;
