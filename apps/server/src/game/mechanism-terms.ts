import { ACTION_SUMMARIES } from "./actions";
import { STAT_LABELS } from "./kernel/attributes";

/**
 * 框架的机制词汇：描述引擎自身机制的词，换一份内容包照样成立。
 *
 * 判据见 `docs/data-driven.md` 的「题材包络」：词指的是机制，就是通用词汇；词指的是
 * 某个内容包的实例（专名、特有材料、特有机关、特有效果分类），才是泄漏。`brawl`、
 * `窃取`、`挥击` 词面带格斗或犯罪味道，但内容包换不掉它们指的机制——能换的只有
 * 「开不开这个能力」。工具名是标识符，不参与散文判断。
 *
 * 两处消费必须同一份，否则词表会漂：`dev/prompt-audit.ts` 把它注入题材审查的
 * rubric（命中即通过），`test/prompt-genericity.test.ts` 用它保证黑名单里不会
 * 混进机制词。
 */

/**
 * 词面带题材味、但在框架里指固定机制的词。
 *
 * 新增一条只问一句：内容包能改掉它指的东西吗？能改（材质、机关、效果分类）就不是
 * 机制词，不该放这里。
 */
const MECHANISM_ONLY_TERMS = [
  "窃取", // steal 的短称：动作标签写的是「取物」
  "搜刮", // loot 的短称：动作标签写的是「搜走物品」
  "挥击", // strike：单体武器攻击
  "横扫", // cleave：多目标武器攻击
  "传音", // call：跨场景传话
  "真名", // teleport / call 的寻址规则，不是世界的设定
  "禁传", // teleport 的可用性，来自场景声明
] as const;

/**
 * 全部机制词汇：动作名与动作标签、属性名，加上只在框架里有定义的术语。
 *
 * 顺序即注入审查 rubric 的顺序，不去重——同一个词出现在不同分组里说明它有两重身份
 * （既是标识符也是中文标签），对审查器没有坏处。
 */
export const MECHANISM_TERMS: readonly string[] = [
  ...Object.keys(ACTION_SUMMARIES),
  ...Object.values(ACTION_SUMMARIES),
  ...Object.keys(STAT_LABELS),
  ...Object.values(STAT_LABELS),
  ...MECHANISM_ONLY_TERMS,
];

/** 注入审查 prompt 的一份清单：按来源分组，审查器据此跳过机制词汇。 */
export function renderMechanismTerms(): string {
  return [
    `动作名（工具标识符）：${Object.keys(ACTION_SUMMARIES).join(" / ")}`,
    `动作的中文标签：${Object.values(ACTION_SUMMARIES).join(" / ")}`,
    `属性名：${Object.keys(STAT_LABELS).join(" / ")}（${Object.values(STAT_LABELS).join(" / ")}）`,
    `机制术语：${MECHANISM_ONLY_TERMS.join(" / ")}`,
  ].join("\n");
}
