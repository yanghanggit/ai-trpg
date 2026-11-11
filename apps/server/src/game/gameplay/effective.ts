import { addStats, finalsOf, type Stats, sourcesOf } from "../kernel/attributes";
import type { EquipmentSlots } from "../kernel/types";

/**
 * 属性来源的收集：哪些东西算进「角色」，哪些只算进「装备」。
 *
 * 规则只有一条：源属性归角色（本体 + 穿戴道具的源属性加成），终值归道具
 * （穿戴中的 `damage` / `block`，加上本次动手而没在穿戴中的那件）。两类分开收集，
 * 不再并进同一个 `Stats` 桶——分层见 `docs/attributes.md`。
 *
 * 只做收集，不做换算：攻击力、格挡、察觉与否归 `combat.ts` / `awareness.ts`。
 * 读库是调用方的事，这里全是纯函数，数据库行与运行时状态共用同一套判断。
 *
 * `maxHp` 是源属性，但装备带来的 `maxHp` 没有读取点：生命上限仍取角色自身的
 * `stats.maxHp`，展示与判活都按那个数。
 */

/** 一件被穿戴或动用的道具；数据库行与运行时状态都满足这个形状。 */
export type Wearable = { readonly name: string; readonly stats: Stats };

/** 现值计算的输入：本体属性、穿戴槽与在穿的道具。 */
export type Wearer = {
  readonly stats: Stats;
  readonly equipment: EquipmentSlots;
  readonly items: readonly Wearable[];
};

/** 角色源属性的现值：本体 + 穿戴中的源属性加成。 */
export function effectiveSourcesOf(wearer: Wearer): Stats {
  return addStats(
    sourcesOf(wearer.stats),
    ...wornItemsOf(wearer).map((item) => sourcesOf(item.stats)),
  );
}

/**
 * 装备终值：穿戴中的 `damage` / `block` 之和。
 *
 * `instrument` 是本次动手用的那件道具。它已经在穿戴槽里时不再重复相加；
 * 在背包里（`use`）才补进来——「谁被拿来动手」始终只算一次。
 */
export function equipmentFinalsOf(wearer: Wearer, instrument?: Wearable): Stats {
  const worn = wornItemsOf(wearer);
  const extras =
    instrument === undefined || isWorn(wearer, instrument) ? [] : [finalsOf(instrument.stats)];
  return addStats(...worn.map((item) => finalsOf(item.stats)), ...extras);
}

function wornItemsOf(wearer: Wearer): readonly Wearable[] {
  const wornNames = wornNamesOf(wearer.equipment);
  return wearer.items.filter((item) => wornNames.has(item.name));
}

function isWorn(wearer: Wearer, item: Wearable): boolean {
  return wornNamesOf(wearer.equipment).has(item.name);
}

/** 槽位 → 道具名的索引；指向不存在道具的悬空槽位由调用方的过滤自然跳过。 */
function wornNamesOf(equipment: EquipmentSlots): ReadonlySet<string> {
  return new Set(Object.values(equipment).filter((name): name is string => name !== undefined));
}
