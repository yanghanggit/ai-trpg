import { GAMEPLAY_RULES, type GameplayRules } from "./rules";

/**
 * 双方数值的对抗：查看与窃取都要过敏捷这一关，判定只在这里定义。
 *
 * 动作层拿到的已经是结论（察觉/得手），不再自己比较数值——否则同一条「谁更快」
 * 会在 `inspect` 与 `steal` 里各写一遍，改规则时漏掉一处。
 *
 * 两侧的现值由调用方读出（`effectiveSourcesOf(wearerView(...))`：本体属性 + 已穿戴的源
 * 属性加成），这一层只比较数字，不读库。
 */
export type AgilityValues = {
  /** 行动者一侧的现值。 */
  readonly self: number;
  /** 对方一侧的现值；对 agent 不公开。 */
  readonly target: number;
};

/** 查看：只有自己更快才不留痕迹；尸体不会察觉。 */
export function inspectNoticed(
  agility: AgilityValues,
  targetAlive: boolean,
  rules: GameplayRules = GAMEPLAY_RULES,
): boolean {
  if (!rules.agilityGovernsAwareness) {
    return false;
  }
  return targetAlive && agility.self <= agility.target;
}

/** 窃取的两种结论：不成立（整次拒绝）与得手但被察觉。 */
export type StealOutcome = {
  readonly allowed: boolean;
  readonly noticed: boolean;
};

/** 窃取：达不到目标敏捷就摸不到；恰好持平能得手，但对方会察觉。 */
export function stealOutcome(
  agility: AgilityValues,
  rules: GameplayRules = GAMEPLAY_RULES,
): StealOutcome {
  if (!rules.agilityGovernsAwareness) {
    return { allowed: true, noticed: false };
  }
  return {
    allowed: agility.self >= agility.target,
    noticed: agility.self === agility.target,
  };
}

/**
 * 规则的中文表述；工具描述与任务提示词共用这一份。
 *
 * 文案跟着开关走，是「关掉一条规则」能真正生效的一半：扣掉判定却留着描述，
 * 模型会按已经不存在的规则行动。
 */
export function awarenessRuleText(
  kind: "inspect" | "steal",
  rules: GameplayRules = GAMEPLAY_RULES,
): string {
  if (!rules.agilityGovernsAwareness) {
    return kind === "inspect" ? "查看不会惊动任何人。" : "窃取不会被拦下，也不会惊动对方。";
  }
  return kind === "inspect"
    ? "你的敏捷高于目标时无人察觉；否则对方知道你在看他的东西。"
    : "你比目标敏捷时无人察觉；持平也能得手，但对方会察觉；不如目标敏捷时一定失手。";
}
