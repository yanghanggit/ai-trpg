import { ACTION_SUMMARIES } from "../../actions";
import { visitedTeleportTargetsFor } from "../../actor-state";
import { DEFAULT_ACTOR_MAX_ROUNDS } from "../../default-rounds";
import { effectiveSourcesOf } from "../../gameplay";
import { describeEquipmentBrief } from "../../item-state/describe";
import { refOf } from "../../kernel/addressing";
import { STAT_LABELS } from "../../kernel/attributes";
import { MAX_ACTIONS_PER_TURN } from "../../kernel/limits";
import { isAlive } from "../../lookup";
import { describeStageAnchors } from "../../stage-state/describe";
import type { ActorTurnContext } from "./context";
import { renderStageEnvironmentForActor, sealedVisitedStageRefsForActor } from "./observed-stage";
import { renderHints } from "./prompt-hints";
import { ACTOR_MEMORY_TOOL_NAMES, ACTOR_READ_ONLY_TOOL_NAMES } from "./tools";

/**
 * actor 本轮的输入：`# 当前环境`（本轮事实）+ `# 本轮任务`（调度顺序与能力提示）。
 *
 * 三段各管一件事，新内容按归属放，不要堆进模板：
 *
 * - 环境段只放本轮可见事实，一律从 state / context 派生，不写规则；
 * - 流程段只放「先读、再写、再提交」这类跨工具的先后顺序——工具描述只说自己做什么；
 * - 提示段（`./prompt-hints.ts`）只放跨工具的先后顺序与取舍；单个工具的契约、参数与代价
 *   写在工具描述里，不在这里复述。
 *
 * 渲染只读 state 与已算好的 context：没有 I/O，也没有写入。
 */
export function renderActorTurnInput(
  context: ActorTurnContext,
  maxRounds: number = DEFAULT_ACTOR_MAX_ROUNDS,
): string {
  return `${renderEnvironment(context)}\n\n${renderTask(context, maxRounds)}`;
}

/** 本轮可见事实：舞台、状态、名单、可去方向；不含任何规则。 */
function renderEnvironment(context: ActorTurnContext): string {
  const { state, current } = context;
  const { actor, stage } = current;
  // 面板与结算用同一份源属性：本体加穿戴加成，终值由它们现算。
  const shown = effectiveSourcesOf(actor);
  // 去过、但现在封着的出口：记忆里的一道门。它不能走，只是认得出来。
  const remembered = sealedVisitedStageRefsForActor(state, current);
  const sealedSection =
    remembered.length === 0
      ? ""
      : `\n\n## 记得封着的出口（认得出，但过不去）\n${remembered.join("、")}`;
  const teleportTargets = visitedTeleportTargetsFor(state, actor, stage);
  const teleportSection = actor.actions.includes("teleport")
    ? `\n\n## 可传送（写对真名即可；下列是去过的、未禁传的）\n${listOrNone(
        teleportTargets.map((item) => item.name),
      )}`
    : "";

  // 两个可选小节各占一个插值位，各自带自己的空行：缺省时不留痕迹。
  return `# 当前环境

## 舞台
${stage.name}
${renderStageEnvironmentForActor(state, current)}

## 你的状态
${actor.name}（你的引用：${context.selfHandle}）| HP ${actor.hp}/${actor.stats.maxHp} | ${STAT_LABELS.strength} ${shown.strength} | ${STAT_LABELS.agility} ${shown.agility}

## 同舞台角色（只列已穿戴的装备）
${renderActorList(context)}

## 可交互锚点
${describeStageAnchors(stage.anchors)}

## 可作用对象
${listOrNone(context.targets)}

## 可移动至
${listOrNone(context.stageRefs)}${sealedSection}${teleportSection}`;
}

/** 同舞台角色：引用 + 死亡标记 + 穿戴摘要；尸体也在名单里。 */
function renderActorList(context: ActorTurnContext): string {
  if (context.others.length === 0) {
    return "无";
  }
  return context.others
    .map((other) => {
      const worn = describeEquipmentBrief(other);
      const dead = isAlive(other) ? "" : "（已死亡）";
      return `${refOf(context.address(other.id))}${dead}${worn.length === 0 ? "" : `｜${worn}`}`;
    })
    .join("\n");
}

/** 调度顺序：三步流程（查与记 → 做 → 提交）+ 按能力出现的提示；名单空则写「无」。 */
export function renderTask(context: ActorTurnContext, maxRounds: number): string {
  const actionList = context.allowed
    .map((kind) => `${kind}（${ACTION_SUMMARIES[kind]}）`)
    .join("、");

  return `# 本轮任务

本轮只有一件事要做：决定并提交 ${MAX_ACTIONS_PER_TURN} 个行动。流程分三步：

1. 先弄清再动手：不知道的先查（${ACTOR_READ_ONLY_TOOL_NAMES.join("、")}，只读）；以后还要用的顺手记下（${ACTOR_MEMORY_TOOL_NAMES.join("、")}：结论写进你自己的认知，只有你自己知道）。两类都不占行动名额，一次回复里能问完就问完，不必为每项信息单独占一轮。本回合的推理预算是 ${maxRounds} 轮，查与记要在前几轮里做完。
2. 做一件：${actionList}。一次回复只提交 ${MAX_ACTIONS_PER_TURN} 个行动——说话、移动、动手都算。动作工具只把动作暂存进计划，不会落账。
3. 提交：submit_plan。必须与那一个动作工具放在同一次回复里调用；只调动作不提交，这一轮就什么都没发生。

${renderHints(context)}`;
}

/** 名单的统一写法：空则写「无」，否则顿号分隔。 */
function listOrNone(items: readonly string[]): string {
  return items.length === 0 ? "无" : items.join("、");
}
