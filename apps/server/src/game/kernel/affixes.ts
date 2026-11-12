import {
  AFFIX_TRIGGERS,
  type Affix,
  type AffixMode,
  type AffixTrigger,
  type AffixTriggers,
} from "./types";

export type { AffixTrigger };

/** 一次触发指向什么：`actor` 才吃命中，`anchor` 只落在可交互锚点上。 */
export type AffixTargetKind = "actor" | "stage" | "anchor";

/**
 * 每个触发的形状：能指向哪些目标、没有伤害 op 时是否也出一次命中。
 *
 * 派发端与内容校验都读这张表，不按触发名写分支：新增触发只补一行。
 */
export const AFFIX_TRIGGER_RULES = {
  strike: { targets: ["actor"], alwaysHits: true },
  cleave: { targets: ["actor"], alwaysHits: true },
  use: { targets: ["actor", "stage", "anchor"], alwaysHits: false },
  fit: { targets: ["anchor"], alwaysHits: false },
} as const satisfies Record<
  AffixTrigger,
  { targets: readonly AffixTargetKind[]; alwaysHits: boolean }
>;

/** 这个触发能否指向角色：决定它能不能声明伤害 op。 */
export function triggerTargetsActor(trigger: AffixTrigger): boolean {
  return (AFFIX_TRIGGER_RULES[trigger].targets as readonly AffixTargetKind[]).includes("actor");
}

/** 这个触发没有伤害 op 时是否也出一次命中。 */
export function triggerAlwaysHits(trigger: AffixTrigger): boolean {
  return AFFIX_TRIGGER_RULES[trigger].alwaysHits;
}

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
  for (const trigger of AFFIX_TRIGGERS) {
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

/** 身上哪几件道具声明了这个触发；名单只由道具自己的词缀决定。 */
export function itemNamesWithTrigger(
  items: readonly { name: string; affixes: AffixTriggers }[],
  trigger: AffixTrigger,
): string[] {
  return items.filter((item) => hasAffixes(item, trigger)).map((item) => item.name);
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
