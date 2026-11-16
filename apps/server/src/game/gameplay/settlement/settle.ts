import { GameError } from "../../errors";
import { staticAffixes, triggerAlwaysHits } from "../../kernel/affixes";
import type { AffixStatRef, AffixTrigger, DamageAmount } from "../../kernel/types";
import type {
  ActorSnapshot,
  HpEffect,
  ItemSnapshot,
  ResolvedRules,
  SettlementInput,
  SettlementOutcome,
  SettlementWitness,
} from "./types";

/**
 * 结算：纯函数，不读库、不调模型、不 import 全局规则。
 *
 * 减伤只有这一处；输出是有序效果列表，逐条落账、不求和。
 */

type StaticContext = {
  attack: number;
  item: ItemSnapshot;
  ambush: boolean;
};

function statValue(context: StaticContext, ref: AffixStatRef): number {
  return ref === "attack" ? context.attack : context.item.stats.damage;
}

function resolveAmount(context: StaticContext, amount: DamageAmount): number {
  if (typeof amount === "number") {
    return amount;
  }
  return Math.round(statValue(context, amount.ref) * (amount.factor ?? 1));
}

/** `{{attack}}` / `{{item.damage}}` / `{{item.name}}`；未知引用属于内容错误。 */
function renderContent(context: StaticContext, content: string): string {
  return content.replace(/\{\{([^}]+)\}\}/g, (_match, token: string) => {
    const key = token.trim();
    if (key === "item.name") {
      return context.item.name;
    }
    if (key === "attack" || key === "item.damage") {
      return String(statValue(context, key as AffixStatRef));
    }
    throw new GameError("invalid_state", `词缀文本引用了未知属性: ${key}`);
  });
}

/** 减防、截断、派生效果：所有伤害路径共用的收尾，减伤只在这一次发生。 */
function finish(input: {
  initiator: ActorSnapshot;
  affected?: ActorSnapshot;
  rules: ResolvedRules;
  hit: boolean;
  hasDamageOps: boolean;
  intended: number;
  witnesses: readonly SettlementWitness[];
  rendered: readonly string[];
  damageLines: readonly string[];
}): SettlementOutcome {
  const { initiator, affected, rules } = input;
  if (input.hit && !affected) {
    throw new GameError("invalid_action", "伤害结算需要被影响者");
  }
  const affectedWasDead = affected !== undefined && affected.hp <= 0;
  const mitigated = input.hit && affected ? Math.max(0, input.intended - affected.stats.block) : 0;
  const actual = input.hit && affected && !affectedWasDead ? Math.min(mitigated, affected.hp) : 0;

  const effects: HpEffect[] = [];
  if (input.hit && affected && !affectedWasDead) {
    // 带减防后的值；账本落账时再按剩余生命截断。
    effects.push({
      kind: "damage",
      role: "affected",
      actorId: affected.actorId,
      hpDelta: -mitigated,
    });
  }
  const lifesteal = Math.floor(actual * rules.params.lifestealRate);
  if (lifesteal > 0 && !initiator.deathFinalized) {
    effects.push({
      kind: "heal",
      role: "initiator",
      actorId: initiator.actorId,
      hpDelta: lifesteal,
    });
  }

  return {
    hit: input.hit,
    hasDamageOps: input.hasDamageOps,
    intended: input.intended,
    mitigated,
    actual,
    affectedWasDead,
    effects,
    witnesses: input.witnesses,
    rendered: input.rendered,
    damageLines: input.damageLines,
  };
}

export function settle(input: SettlementInput): SettlementOutcome {
  const { action, initiator, item, ambush } = input;
  // `brawl` 不是词缀触发：它没有道具，但仍然走同一条结算，`intended` 取快照攻击力。
  const trigger: AffixTrigger | undefined = action === "brawl" ? undefined : action;
  const context: StaticContext | undefined = item
    ? { attack: initiator.stats.damage, item, ambush }
    : undefined;

  let affixDamage = 0;
  let hasDamageOps = false;
  const witnesses: SettlementWitness[] = [];
  const rendered: string[] = [];
  const damageLines: string[] = [];

  for (const affix of item && trigger ? staticAffixes(item, trigger) : []) {
    const contextForAffix = context as StaticContext;
    const line = `[${affix.name}]${renderContent(contextForAffix, affix.content)}`;
    let active = false;
    let hasDamage = false;
    for (const op of affix.ops ?? []) {
      if (op.kind === "damage") {
        // 静态条件只读引擎事实：条件不成立时这条 op 不参与求和，也不留下文本。
        if (op.when === "ambush" && !contextForAffix.ambush) {
          continue;
        }
        affixDamage += resolveAmount(contextForAffix, op.amount);
        hasDamageOps = true;
        hasDamage = true;
        active = true;
        continue;
      }
      witnesses.push({
        affixName: affix.name,
        template: op.template,
        visibility: op.visibility ?? "stage",
      });
      active = true;
    }
    if (active) {
      rendered.push(line);
    }
    if (hasDamage) {
      damageLines.push(line);
    }
  }

  // `brawl` 恒命中；武器动作看触发表，`use` 只有声明伤害才出命中。
  const hit = trigger === undefined ? true : triggerAlwaysHits(trigger) || hasDamageOps;
  const intended = (action === "brawl" ? initiator.stats.damage : 0) + affixDamage;

  return finish({
    initiator,
    ...(input.affected ? { affected: input.affected } : {}),
    rules: input.rules,
    hit,
    hasDamageOps,
    intended,
    witnesses,
    rendered,
    damageLines,
  });
}

/** agent 追加的伤害：数值由推理端给出，减防仍在引擎发生一次。 */
export function settleAdditionalDamage(input: {
  initiator: ActorSnapshot;
  affected: ActorSnapshot;
  rawDamage: number;
  rules: ResolvedRules;
}): SettlementOutcome {
  return finish({
    initiator: input.initiator,
    affected: input.affected,
    rules: input.rules,
    hit: true,
    hasDamageOps: true,
    intended: Math.max(0, input.rawDamage),
    witnesses: [],
    rendered: [],
    damageLines: [],
  });
}
