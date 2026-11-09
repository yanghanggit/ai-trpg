import { STAT_KEYS, STAT_LABELS, type Stats } from "../attributes";
import type { Affix } from "../types";
import { type WorldConstitution, worldFunctionAgent } from "../world-function";
import type { AffixTrigger } from "./model";
import type { StaticSettlement } from "./static";
import type { StaticOutcome } from "./types";

/** 属性渲染成 `力量 8、格挡 2`；未用到的字段不出现，全 0 写“无”。 */
function statsText(stats: Stats): string {
  const parts = STAT_KEYS.filter((key) => stats[key] !== 0).map(
    (key) => `${STAT_LABELS[key]} ${stats[key]}`,
  );
  return parts.length > 0 ? parts.join("、") : "无";
}

/** 词缀判定的宪法：建局时装配好的完整文本。 */
export function buildAffixSystemPrompt(world: WorldConstitution): string {
  return worldFunctionAgent(world, "affixes").systemPrompt;
}

export function buildAffixPrompt(input: {
  actorName: string;
  actorStats: Stats;
  itemName: string;
  itemDescription: string;
  itemStats: Stats;
  trigger: AffixTrigger;
  affixes: readonly Affix[];
  defaultFeedback: string;
  staticSettlement?: StaticSettlement;
  staticOutcome?: StaticOutcome;
  terminalToolName: string;
  targetName?: string;
  targetForm?: string;
  targetAppearance?: string;
  targetHp?: string;
  targetBlock?: number;
  stageName: string;
}): string {
  const targetFacts = [
    input.targetForm ? `形态：${input.targetForm}` : "",
    input.targetAppearance ? `外观：${input.targetAppearance}` : "",
    input.targetBlock !== undefined ? `${STAT_LABELS.block}：${input.targetBlock}` : "",
    input.targetHp ? `HP：${input.targetHp}` : "",
  ].filter((line) => line.length > 0);
  const staticFacts =
    input.staticSettlement === undefined
      ? "无（本次没有静态词缀）"
      : [
          ...input.staticSettlement.rendered.map((line) => `- ${line}`),
          input.staticSettlement.hasDamageOps
            ? `静态伤害合计：${input.staticSettlement.rawDamage}，扣除防御后 ${input.staticSettlement.damage}`
            : "静态词缀没有造成伤害",
          ...(input.staticOutcome
            ? [
                `实际造成伤害：${input.staticOutcome.dealtDamage}`,
                `目标 HP 归零：${input.staticOutcome.targetDied ? "是" : "否"}`,
              ]
            : []),
        ].join("\n");

  return `# 词缀任务

静态词缀已结算并提交；你只判定下列 mode=agent 的词缀，用工具追加后果。

## 静态结算
${staticFacts}

## 动作结果
${input.defaultFeedback}

## 结算对象
场景：${input.stageName}
触发：${input.trigger}
持有者：${input.actorName}（${statsText(input.actorStats)}）
物品：${input.itemName}（${statsText(input.itemStats)}）
${input.itemDescription}
词缀：
${input.affixes.map((affix) => `- [${affix.name}]${affix.content}`).join("\n")}
目标：${input.targetName ?? "无角色目标"}
${targetFacts.join("\n")}

## 规则

- **判定**：按语义读词缀的对象、条件、效果与比例，以上方事实判定；同义、上下位都算成立。
- **不要重复**：静态已造成的伤害不要再算一次；你的 damage_target 只追加词缀本身的补充值。
- **数值**：走 damage_target；不叠加静态结算。
- **可见后果**：走 record_witness。template 只能用 {source}/{target}/{anchor}/{item} 占位，禁止写名字或编号；只写旁人可见的事实，不写数值、机制与心理。
- **不成立但过程可见**：可以用 record_witness 记一条可见见证；完全不可见就什么都不做。
- **收尾**：无论是否落账，必调 ${input.terminalToolName}。`;
}
