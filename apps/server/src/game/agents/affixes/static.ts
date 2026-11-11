import { GameError } from "../../errors";
import {
  attackPower,
  effectiveSourcesOf,
  equipmentFinalsOf,
  guardPower,
  mitigatedDamage,
} from "../../gameplay";
import { type AffixTrigger, staticAffixes } from "../../kernel/affixes";
import type { AffixStatRef, AffixTriggers, DamageAmount } from "../../kernel/types";
import { wearerView } from "../../lookup";
import type { ActorRow, ActorWithStageRow, Executor } from "../../persistence/rows";

/** 静态见证：文本与目标由动作层补齐后交给 witness 渲染。 */
export type StaticWitness = {
  affixName: string;
  template: string;
  visibility: "stage" | "target";
};

export type StaticSettlement = {
  /** 是否声明了 damage op；strike 恒出命中，use 只在有 damage op 时出命中。 */
  hasDamageOps: boolean;
  /** 所有静态伤害之和，未减 block。 */
  rawDamage: number;
  /** 动作级唯一一次减伤后的最终伤害。 */
  damage: number;
  witnesses: StaticWitness[];
  /** 逐条渲染后的词缀文本，供 agent prompt 使用。 */
  rendered: string[];
  /** 含 damage op 的词缀文本；公共消息只写总数，逐条分解进舞台记忆。 */
  damageLines: string[];
};

type StaticContext = {
  actorRow: ActorWithStageRow;
  /** 本次攻击的攻击力：源属性现算 + 装备终值（含本次道具），与防御同一口径。 */
  attack: number;
  item: { name: string; stats: ActorWithStageRow["actor"]["stats"]; affixes: AffixTriggers };
};

/**
 * 词缀可引用的数值。
 *
 * `attack` 不是某个字段，而是结算期算出来的攻击力（源属性现算 + 装备终值），
 * 所以 `{{attack}}` 的文本值与实际扣血始终是同一个数。
 * 另一个引用 `item.damage` 是道具终值原值，不换算；角色没有 `damage` 可引用。
 */
function statValue(context: StaticContext, ref: AffixStatRef): number {
  return ref === "attack" ? context.attack : context.item.stats.damage;
}

function resolveAmount(context: StaticContext, amount: DamageAmount): number {
  if (typeof amount === "number") {
    return amount;
  }
  return Math.round(statValue(context, amount.ref) * (amount.factor ?? 1));
}

/** `{{attack}}` / `{{item.damage}}` 只插数值与公共道具名；名字不允许出现。 */
function renderStaticContent(context: StaticContext, content: string): string {
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

/**
 * 静态阶段：按数组顺序执行静态词缀，聚合伤害并收集见证。
 *
 * 纯函数语义：无 LLM、无随机；伤害求和后只减一次 `block`。
 * 没有目标却声明了 damage op 属于内容错误，直接拒绝而不是静默算 0。
 */
export async function settleStaticAffixes(input: {
  executor: Executor;
  actorRow: ActorWithStageRow;
  item: StaticContext["item"];
  trigger: AffixTrigger;
  target?: ActorRow;
}): Promise<StaticSettlement> {
  const { executor, actorRow, item, trigger, target } = input;
  const attacker = await wearerView(executor, actorRow.actor);
  const context: StaticContext = {
    actorRow,
    attack: attackPower(effectiveSourcesOf(attacker), equipmentFinalsOf(attacker, item)),
    item,
  };
  let rawDamage = 0;
  let hasDamageOps = false;
  const witnesses: StaticWitness[] = [];
  const rendered: string[] = [];
  const damageLines: string[] = [];

  for (const affix of staticAffixes(item, trigger)) {
    const line = `[${affix.name}]${renderStaticContent(context, affix.content)}`;
    rendered.push(line);
    let affixHasDamage = false;
    for (const op of affix.ops ?? []) {
      if (op.kind === "damage") {
        rawDamage += resolveAmount(context, op.amount);
        hasDamageOps = true;
        affixHasDamage = true;
        continue;
      }
      witnesses.push({
        affixName: affix.name,
        template: op.template,
        visibility: op.visibility ?? "stage",
      });
    }
    if (affixHasDamage) {
      damageLines.push(line);
    }
  }
  if (hasDamageOps && !target) {
    throw new GameError("invalid_action", "伤害词缀需要角色目标");
  }
  // 减伤只有玩法层那一个入口：先求和，再减一次目标的装备格挡。
  const damage =
    hasDamageOps && target
      ? mitigatedDamage(
          rawDamage,
          guardPower(equipmentFinalsOf(await wearerView(executor, target))),
        )
      : 0;

  return {
    hasDamageOps,
    rawDamage,
    damage,
    witnesses,
    rendered,
    damageLines,
  };
}
