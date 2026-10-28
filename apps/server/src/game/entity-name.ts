import type { ItemKind } from "./types";

/**
 * 实体名的层级前缀。
 *
 * 前缀是系统概念，不是故事设定：每个前缀对应一个代码类型（world / stage / actor /
 * 物品的六个大类）。内容层只能沿用这套词汇，不能自创前缀。
 */
export const ENTITY_PREFIX = {
  world: "世界",
  stage: "场景",
  actor: "角色",
  weapon: "武器",
  equipment: "装备",
  accessory: "饰品",
  consumable: "消耗品",
  valuable: "贵重物",
  material: "材料",
} as const;

export type EntityKind = keyof typeof ENTITY_PREFIX;

/** 物品大类到前缀的唯一映射；名称前缀必须与 `kind` 一致。 */
export const ITEM_PREFIX: Record<ItemKind, string> = {
  weapon: ENTITY_PREFIX.weapon,
  equipment: ENTITY_PREFIX.equipment,
  accessory: ENTITY_PREFIX.accessory,
  consumable: ENTITY_PREFIX.consumable,
  valuable: ENTITY_PREFIX.valuable,
  material: ENTITY_PREFIX.material,
};

const KIND_BY_PREFIX = new Map<string, EntityKind>(
  Object.entries(ENTITY_PREFIX).map(([kind, prefix]) => [prefix, kind as EntityKind]),
);

export type ParsedEntityName = {
  /** 前缀对应的实体类别；没有前缀或前缀未知时为 null。 */
  kind: EntityKind | null;
  /** 名称里的前缀原文；没有前缀时为空串。 */
  prefix: string;
  /** 去掉前缀后的部分；没有前缀时等于原名。 */
  plain: string;
};

/** 用系统词汇拼出规范名；内容层需要生成名字时用它，而不是手写点号。 */
export function entityName(kind: EntityKind, plain: string): string {
  return `${ENTITY_PREFIX[kind]}.${plain}`;
}

/**
 * 拆分实体名。只按第一个点切分：点之前必须是一个已知前缀，点之后整体是名称。
 *
 * 前缀未知时 `kind` 为 null，但仍会切出 `plain`；是否接受由调用方决定。
 */
export function splitEntityName(raw: string): ParsedEntityName {
  const dot = raw.indexOf(".");
  if (dot <= 0 || dot === raw.length - 1) {
    return { kind: null, prefix: "", plain: raw };
  }
  const prefix = raw.slice(0, dot);
  return { kind: KIND_BY_PREFIX.get(prefix) ?? null, prefix, plain: raw.slice(dot + 1) };
}

export function entityKindOf(raw: string): EntityKind | null {
  return splitEntityName(raw).kind;
}

/** 面向世界内的写法：去掉类型前缀，只留名称。 */
export function plainEntityName(raw: string): string {
  return splitEntityName(raw).plain;
}

/**
 * 是否为该类别下的规范名。
 *
 * 不带前缀的写法不算规范名；它只用于测试夹具或过渡内容，正式内容由内容校验与
 * seed 守卫共同拒绝。
 */
export function isCanonicalName(raw: string, kind: EntityKind): boolean {
  return splitEntityName(raw).kind === kind;
}
