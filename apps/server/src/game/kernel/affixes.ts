import type { Affix, AffixMode, AffixTriggers } from "./types";

/** 道具能触发的舞台：三种动作各取自己的词缀列表；后续若要扩 `equip` 等，只加 key。 */
export type AffixTrigger = keyof AffixTriggers;

/** 省略 `mode` 等于 static；物化时统一成显式值，避免等价判定被 `undefined` 干扰。 */
export function affixMode(affix: Affix): AffixMode {
  return affix.mode ?? "static";
}

function normalizeAffix(affix: Affix): Affix {
  return affix.mode === undefined ? { ...affix, mode: "static" } : affix;
}

/** 归一化触发列表：空列表等同于未声明，避免 `[]` 与 `undefined` 参与等价判定。 */
export function normalizeAffixTriggers(affixes: AffixTriggers | undefined): AffixTriggers {
  const result: AffixTriggers = {};
  for (const trigger of ["strike", "cleave", "use"] as const) {
    const list = affixes?.[trigger];
    if (list && list.length > 0) {
      result[trigger] = list.map(normalizeAffix);
    }
  }
  return result;
}

export function affixesFor(
  item: { affixes: AffixTriggers },
  trigger: AffixTrigger,
): readonly Affix[] {
  return item.affixes[trigger] ?? [];
}

export function hasAffixes(item: { affixes: AffixTriggers }, trigger: AffixTrigger): boolean {
  return affixesFor(item, trigger).length > 0;
}

export function agentAffixes(
  item: { affixes: AffixTriggers },
  trigger: AffixTrigger,
): readonly Affix[] {
  return affixesFor(item, trigger).filter((affix) => affixMode(affix) === "agent");
}

export function staticAffixes(
  item: { affixes: AffixTriggers },
  trigger: AffixTrigger,
): readonly Affix[] {
  return affixesFor(item, trigger).filter((affix) => affixMode(affix) === "static");
}
