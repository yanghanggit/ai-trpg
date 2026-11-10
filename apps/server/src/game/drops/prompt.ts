import type { ActorState, StageState, WorldState } from "../types";
import { worldFunctionPrompt } from "../world-function";

/**
 * 掉落推理的提示词：这一轮要模型看什么，以及掉落裁决的宪法。
 *
 * 掉落只看得到尸体本身与所在场景；不注入死者记忆，掉落必须是外部可观察的事实。
 * 外观小节报「此刻的可见外观」而不是「尸体外观」：尸体外观是至多一次的后置推理，
 * 没跑成时这里就是生前最后一条记录，不能向模型承诺它一定是尸体描写。
 * 世界设定是任务上下文：材料会变成公共物品名并被玩家反复引用，必须使用该世界
 * 自己的材质、工艺与叫法，不能靠模型的世界外常识补全。
 */

/** 掉落裁决的宪法：建局时装配好的完整文本。 */
export function buildDropSystemPrompt(world: WorldState): string {
  return worldFunctionPrompt(world, "drops");
}

export function buildDropTurnInput(actor: ActorState, stage: StageState): string {
  return `# 尸体掉落

${actor.name}刚刚死亡。

## 形态

${actor.signature.form}

## 此刻的可见外观

${actor.appearance.text}

## 所在场景

${stage.name}：${stage.environment}

# 本轮任务

判断这具尸体在被搜刮之前留下什么可以被别人捡走的材料。只写尸体本身产生的、可以被别人搜走的实体残留，材质不限；不写它穿戴的东西。

材料名与描述不得含角色名或编号引用。

不写它原本持有的物品；那些留在它的背包里，不走掉落。不写心理、名字与规则，不解释推理过程。没有合理产物就提交空数组。完成后调用 drop_materials 提交。`;
}
