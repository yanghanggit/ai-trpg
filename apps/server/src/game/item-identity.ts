/**
 * 物品等价判定：两件东西是不是「同一种」。
 *
 * 一个作用域里一个物品名只有一行（见 `docs/items.md`）：等价的两份并进 `count`，
 * 不等价的直接拒绝。判定只读会影响玩法与展示的字段——`seq`、`count`、归属与内容键
 * 都是来源信息，不参与比较。
 */

/** 参与等价判定的字段；物品行与内容声明都能满足这个形状。 */
export type ItemIdentity = {
  kind: string;
  name: string;
  description: string;
  stats: unknown;
  affixes: unknown;
  actions: unknown;
  source: string | null;
};

/** 递归按键排序的 JSON：jsonb 读回的键序不稳定，不能直接比较字符串。 */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** `actions` 是能力集合，声明顺序不改变语义；先排序再比。 */
function actionsOf(value: ItemIdentity["actions"]): readonly string[] {
  return Array.isArray(value) ? [...(value as readonly string[])].sort() : [];
}

/** 两件物品是不是同一种：可以并成一行、共用 `count`。 */
export function isSameItem(a: ItemIdentity, b: ItemIdentity): boolean {
  return (
    a.kind === b.kind &&
    a.name === b.name &&
    a.description === b.description &&
    a.source === b.source &&
    stableJson(a.stats) === stableJson(b.stats) &&
    stableJson(a.affixes) === stableJson(b.affixes) &&
    stableJson(actionsOf(a.actions)) === stableJson(actionsOf(b.actions))
  );
}
