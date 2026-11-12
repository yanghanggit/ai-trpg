import type { AffixTrigger } from "../../kernel/affixes";
import { STAT_KEYS, STAT_LABELS, type Stats } from "../../kernel/attributes";
import type { Affix, WorldState } from "../../kernel/types";
import { worldFunctionPrompt } from "../../world-function";
import type { StaticSettlement } from "./static";
import type { StaticOutcome } from "./types";

/** 属性渲染成 `力量 8、格挡 2`；未用到的字段不出现，全 0 写“无”。 */
function statsText(stats: Stats): string {
  const parts = STAT_KEYS.filter((key) => stats[key] !== 0).map(
    (key) => `${STAT_LABELS[key]} ${stats[key]}`,
  );
  return parts.length > 0 ? parts.join("、") : "无";
}

/**
 * 一个被作用到的角色：面板事实 + 这一下在静态阶段的真实结果。
 *
 * 目标是名单而不是单个角色：单体动作为一项，横扫是全部，渲染与判定都读同一份。
 */
export type AffixTargetFacts = {
  name: string;
  form?: string;
  appearance?: string;
  block?: number;
  hp?: string;
  outcome?: StaticOutcome;
};

/** 名单里的一行：名字 + 这个角色自己的事实。 */
function describeTarget(target: AffixTargetFacts): string {
  const facts = [
    target.form ? `形态：${target.form}` : "",
    target.appearance ? `外观：${target.appearance}` : "",
    target.block !== undefined ? `${STAT_LABELS.block}：${target.block}` : "",
    target.hp ? `HP：${target.hp}` : "",
    target.outcome
      ? `静态实际造成伤害：${target.outcome.dealtDamage}，HP 归零：${target.outcome.targetDied ? "是" : "否"}`
      : "",
  ].filter((line) => line.length > 0);
  return `- ${target.name}${facts.length > 0 ? `｜${facts.join("｜")}` : ""}`;
}

/** 词缀判定的宪法：建局时装配好的完整文本。 */
export function buildAffixSystemPrompt(world: WorldState): string {
  return worldFunctionPrompt(world, "affixes");
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
  /** 这次动作作用到的角色；每一项带自己的静态实际结果。 */
  targets?: readonly AffixTargetFacts[];
  terminalToolName: string;
  stageName: string;
}): string {
  const staticFacts =
    input.staticSettlement === undefined
      ? "无（本次没有静态词缀）"
      : [
          ...input.staticSettlement.rendered.map((line) => `- ${line}`),
          input.staticSettlement.hasDamageOps
            ? `静态伤害合计：${input.staticSettlement.rawDamage}（每个目标各自减防，实际结果见目标行）`
            : "静态词缀没有造成伤害",
        ].join("\n");

  return `# 词缀任务

静态词缀已结算并提交；你只判定下列 mode=agent 的词缀，用工具追加后果。

## 静态结算
${staticFacts}

## 动作结果
${input.defaultFeedback}

## 结算对象
舞台：${input.stageName}
触发：${input.trigger}
持有者：${input.actorName}（${statsText(input.actorStats)}）
道具：${input.itemName}（${statsText(input.itemStats)}）
${input.itemDescription}
词缀：
${input.affixes.map((affix) => `- [${affix.name}]${affix.content}`).join("\n")}

## 目标
${input.targets && input.targets.length > 0 ? input.targets.map(describeTarget).join("\n") : "无角色目标"}

## 规则

- **判定**：按语义读参与判定的对象、条件与比例，同义与上下位都算成立；过程可见但后果不成立，也可以留一条见证。
- **名单**：目标是名单时逐人判断；damage_target 与 record_witness 点到谁，后果只落在谁身上。
- **措辞**：见证用占位符写，只留旁人看得见的事实，不写名字、编号、数值、机制与心理。
- **收尾**：无论是否落账，必调 ${input.terminalToolName}。`;
}
