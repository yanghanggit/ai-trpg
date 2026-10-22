import type { Skill } from "./types";

/** 所有 actor 默认掌握的攻击技能；伤害由 attack 与 defense 直接计算。 */
export const ATTACK_SKILL: Skill = {
  key: "attack",
  name: "攻击",
  description: "使用武器或身体攻击同场景中的一个目标，试图造成伤害。",
  broadcast: "stage",
  resolution: "computed",
  purposeKinds: ["damage"],
  itemPolicy: "optional",
};

/** 当前可用的技能目录；actor 的 skills 从这里取用。 */
export const SKILLS = [ATTACK_SKILL] as const;
