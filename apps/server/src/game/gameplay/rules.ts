/**
 * 数值对抗的开关表：引擎里唯一能改「哪个属性影响什么」的地方。
 *
 * 表里的每条都是玩法层的临时取舍，不是引擎的必然——力量并入攻击力、敏捷决定察觉，
 * 都可以换成另一套算法或直接关掉。换算与对抗的实现在 `combat.ts` / `awareness.ts`，
 * 开关只决定它们退化成什么形式；动作流程因此不需要知道规则是什么，只问结果。
 *
 * 关掉一条规则时，动作反馈与工具描述里的表述跟着同一份开关走（例：
 * `awarenessRuleText`），不会出现「规则关了、提示词还在描述」的分叉。
 *
 * 改这里的成本是测试要跟着改：`test/gameplay.test.ts` 逐条断言开关生效。
 */
export const GAMEPLAY_RULES = {
  /** 力量是否换算成攻击力；关掉后攻击力只剩装备终值里的 `damage`。 */
  strengthAddsToAttack: true,
  /** 查看与窃取是否比敏捷；关掉后两者恒不被察觉、窃取恒得手。 */
  agilityGovernsAwareness: true,
} as const;

/** 开关表的可传参形状：测试与将来的实验按需覆盖一条，不必改全局常量。 */
export type GameplayRules = { readonly [Key in keyof typeof GAMEPLAY_RULES]: boolean };
