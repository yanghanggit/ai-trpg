import { GameError } from "../errors";
import type {
  ActionKind,
  CarriedActionKind,
  HeldActionKind,
  InnateActionKind,
  ItemKind,
  SlotActionKind,
} from "../kernel/types";

/** 槽位携带：穿戴中的道具借给穿戴者，卸下即收回。 */
export const SLOT_ACTION_KINDS = ["strike", "cleave"] as const;

/** 持有携带：身上声明了 `affixes.use` 的道具借给持有者，与是否穿在槽里无关。 */
export const HELD_ACTION_KINDS = ["use"] as const;

/** 两类都不写进角色 `actions`。 */
export const CARRIED_ACTION_KINDS = [...SLOT_ACTION_KINDS, ...HELD_ACTION_KINDS] as const;

/** 角色固有动作：内容层逐角色显式声明，与携带者是否存在无关。 */
export const INNATE_ACTION_KINDS = [
  "say",
  "whisper",
  "announce",
  "call",
  "move",
  "teleport",
  "wait",
  "hide",
  "reveal",
  "brawl",
  "steal",
  "inspect",
  "loot",
  "give",
  "pickup",
  "fit",
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
  "hide",
  "reveal",
  "strike",
  "cleave",
  "brawl",
  "steal",
  "inspect",
  "loot",
  "give",
  "pickup",
  "use",
  "fit",
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

/** 会用到多目标上限的动作；上限本身属于道具，这里只声明谁读它。 */
export const MULTI_TARGET_ACTION_KINDS = ["cleave"] as const satisfies readonly ActionKind[];

/** 槽位携带者表：没登记的大类不能授予任何槽位动作；持有携带不看这张表。 */
export const CARRIED_ACTIONS_BY_ITEM_KIND = {
  weapon: SLOT_ACTION_KINDS,
} as const satisfies Partial<Record<ItemKind, readonly SlotActionKind[]>>;

export function carriedActionsForKind(kind: ItemKind): readonly SlotActionKind[] {
  const table: Partial<Record<ItemKind, readonly SlotActionKind[]>> = CARRIED_ACTIONS_BY_ITEM_KIND;
  return table[kind] ?? [];
}

/** 槽位携带的判定：`use` 永不由槽位授予。 */
export function isSlotActionKind(kind: CarriedActionKind): kind is SlotActionKind {
  return (SLOT_ACTION_KINDS as readonly string[]).includes(kind);
}

export const ACTION_SUMMARIES: Record<ActionKind, string> = {
  say: "对目标公开说话",
  whisper: "对目标耳语，只有对方听见",
  announce: "向当前舞台公开说话",
  call: "用真名向另一个有传音能力的角色传话",
  move: "移动到相邻舞台",
  teleport: "传送到真名对应的舞台",
  wait: "留在原地",
  hide: "隐入暗处，旁人不再被动看见你",
  reveal: "从暗处现身，让同舞台旁人看见你",
  strike: "用装备的武器攻击同舞台目标",
  cleave: "用装备的武器同时攻击同舞台的多个目标",
  brawl: "用身体与同舞台目标肉搏",
  steal: "从活着的目标身上取物",
  inspect: "查看同舞台目标随身携带的全部道具（察觉看敏捷）",
  loot: "从同舞台的尸体上搜走道具（默认全部）",
  give: "把自己的道具交给目标",
  pickup: "拾起舞台道具",
  use: "用自己的道具作用于角色或舞台",
  fit: "把自己的一件道具对上舞台锚点",
  equip: "把背包里的道具穿到槽位",
  unequip: "卸下某个槽位的装备",
};

/**
 * 角色可用的行动：固有动作 ∪ 槽位携带 ∪ 持有携带；顺序固定，不随合并顺序变化。
 *
 * 工具列表、提示词里的动作列举、结算前的授权都用这一份结果，避免三处各自算。
 */
export function allowedActionKinds(
  innateActions: readonly InnateActionKind[],
  slotCarriedActions: readonly SlotActionKind[] = [],
  heldActions: readonly HeldActionKind[] = [],
): ActionKind[] {
  const available: readonly ActionKind[] = [
    ...innateActions,
    ...slotCarriedActions,
    ...heldActions,
  ];
  return ACTION_KINDS.filter((kind) => available.includes(kind));
}

/** 结算前的权威校验：`allowedActions` 是已经合并过携带者动作的可用清单。 */
export function assertActionAllowed(
  allowedActions: readonly ActionKind[],
  kind: ActionKind,
  actorName: string,
  /** 这个动作为什么不可用；省略时用通用文案。 */
  reason?: string,
): void {
  if (allowedActions.includes(kind)) {
    return;
  }
  // actorName 就是实体的名字，CLI 与日志直接用它定位。
  throw new GameError("invalid_action", reason ?? `${actorName}不能使用动作: ${kind}`);
}
