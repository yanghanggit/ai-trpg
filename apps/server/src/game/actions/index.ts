import { GameError } from "../errors";
import type { ActionKind, CarriedActionKind, InnateActionKind, ItemKind } from "../types";

/**
 * 携带者授予的动作：只能由穿戴中的物品提供，角色无法固有声明。
 *
 * 目前唯一的携带者是武器；新增携带者动作时先加在这里，内容校验、工具装配与
 * 授权合并都从这一份派生。
 */
export const CARRIED_ACTION_KINDS = ["strike", "cleave"] as const;

/** 角色固有动作：内容层逐角色显式声明，与携带者是否存在无关。 */
export const INNATE_ACTION_KINDS = [
  "say",
  "whisper",
  "announce",
  "call",
  "move",
  "teleport",
  "wait",
  "brawl",
  "steal",
  "loot",
  "give",
  "pickup",
  "use",
  "equip",
  "unequip",
] as const;

/** 全部动作 kind；顺序与提示词里的列举保持一致，供测试与文档引用。 */
export const ACTION_KINDS = [
  "say",
  "whisper",
  "announce",
  "call",
  "move",
  "teleport",
  "wait",
  "strike",
  "cleave",
  "brawl",
  "steal",
  "loot",
  "give",
  "pickup",
  "use",
  "equip",
  "unequip",
] as const satisfies readonly ActionKind[];

/**
 * 编译期穷尽检查：两个来源的并集必须正好覆盖全部动作，新增 kind 忘了归类就报错。
 *
 * 导出不是给调用方用的，是让这两个类型真正参与检查（未使用的类型别名不报错）。
 */
type AssertNever<T extends never> = T;
export type ActionKindSourceCoverage = [
  AssertNever<Exclude<InnateActionKind, (typeof INNATE_ACTION_KINDS)[number]>>,
  AssertNever<Exclude<CarriedActionKind, (typeof CARRIED_ACTION_KINDS)[number]>>,
];

/**
 * 携带者规则：哪种物品能授予哪些动作。
 *
 * 现在只有武器；未来的携带者（如工具、法器）只在这里加一行，内容校验与运行时
 * 授权同时生效，不需要再改授权链。没登记的物品类不能授予任何动作。
 */
export const CARRIED_ACTIONS_BY_ITEM_KIND = {
  weapon: CARRIED_ACTION_KINDS,
} as const satisfies Partial<Record<ItemKind, readonly CarriedActionKind[]>>;

/** 某种物品能授予的动作；没登记的物品类返回空清单。 */
export function carriedActionsForKind(kind: ItemKind): readonly CarriedActionKind[] {
  const table: Partial<Record<ItemKind, readonly CarriedActionKind[]>> =
    CARRIED_ACTIONS_BY_ITEM_KIND;
  return table[kind] ?? [];
}

export const ACTION_SUMMARIES: Record<ActionKind, string> = {
  say: "对目标公开说话",
  whisper: "对目标耳语，只有对方听见",
  announce: "向当前场景公开说话",
  call: "用真名向另一个有传音能力的角色传话",
  move: "移动到相邻场景",
  teleport: "传送到真名对应的场景",
  wait: "留在原地",
  strike: "用装备的武器攻击同场景目标",
  cleave: "用装备的武器同时攻击同场景的多个目标",
  brawl: "用身体与同场景目标肉搏",
  steal: "从活着的目标身上取物",
  loot: "从同场景的尸体上搜走物品（默认全部）",
  give: "把自己的物品交给目标",
  pickup: "拾起场景物品",
  use: "用自己的物品作用于角色或场景",
  equip: "把背包里的物品穿到槽位",
  unequip: "卸下某个槽位的装备",
};

/**
 * 角色可用的行动：固有动作 ∪ 携带者授予的动作；顺序固定，不随合并顺序变化。
 *
 * 工具列表、提示词里的动作列举、结算前的授权都用这一份结果，避免三处各自算。
 */
export function allowedActionKinds(
  innateActions: readonly InnateActionKind[],
  carriedActions: readonly CarriedActionKind[] = [],
): ActionKind[] {
  const available: readonly ActionKind[] = [...innateActions, ...carriedActions];
  return ACTION_KINDS.filter((kind) => available.includes(kind));
}

/** 结算前的权威校验：`allowedActions` 是已经合并过携带者动作的可用清单。 */
export function assertActionAllowed(
  allowedActions: readonly ActionKind[],
  kind: ActionKind,
  actorName: string,
): void {
  if (allowedActions.includes(kind)) {
    return;
  }
  // actorName 就是实体的名字，CLI 与日志直接用它定位。
  throw new GameError("invalid_action", `${actorName}不能使用动作: ${kind}`);
}
