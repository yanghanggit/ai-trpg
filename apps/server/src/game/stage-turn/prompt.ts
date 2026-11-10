import { isAlive } from "../apply/queries";
import { describeStageAnchors } from "../stage-state/describe";
import type { GameStateSlice, StageState } from "../types";
import { type StageTurnContext, stageTurnContext } from "./context";

/**
 * stage 小 GM 本轮的当前场景观察与仲裁规则；仲裁与探针共用。
 *
 * 规则按能力逐条出现：没有 notify_world 就不提通知，锚点不可改就说不可改。
 * 这些是「编排」而非工具契约，所以写在提示词里而不是每个工具的 description 里。
 */
export function buildStageTurnInput(state: GameStateSlice, stage: StageState): string {
  return renderStageTurnInput(stageTurnContext(state, stage));
}

/** 已经算好上下文时直接渲染：回合里提示词与工具表各取一份，不再重复派生。 */
export function renderStageTurnInput(context: StageTurnContext): string {
  const { stage, allowed } = context;
  const canSubmit = allowed.includes("submit_environment");
  const canOpen = allowed.includes("open_passage");
  const canNotify = allowed.includes("notify_world");
  const anchorTools = (["add_anchor", "remove_anchor", "update_anchor"] as const).filter((kind) =>
    allowed.includes(kind),
  );
  const actorLines =
    stage.actors.length === 0
      ? "无"
      : stage.actors
          .map(
            (actor) =>
              `${actor.name}：${actor.appearance.text}${isAlive(actor) ? "" : "（已死亡）"}`,
          )
          .join("\n");
  const moveLines = context.moves.length === 0 ? "无" : context.moves.join("、");
  const sealedLines = context.sealed.length === 0 ? "无" : context.sealed.join("、");
  const taskLines = [
    ...(canSubmit
      ? [
          "environment 是本场景此刻可被观察到的状态：只有本轮已落账的动作结果真的改变了场景（物品移动、破坏、出现新的可作用点）才提交完整快照；台词、打算、观察与原地等待都不算。",
          "environment 是演员看得见的东西：不能写角色名或 #编号，也不要替演员说出未打通的通道对面是哪里——那是要他们自己发现、问到的事。",
          "没有变化就不要提交 environment；只读工具的观察不是场景变化，角色携带的物品也不属于 environment。",
          "environment 是完整快照，不是差异；同一轮多次提交时后一次覆盖前一次。",
        ]
      : []),
    ...(anchorTools.length > 0
      ? [
          `锚点是场景的可供性，可由你调整：${anchorTools.join(" / ")}。标签场景内唯一，总数有上限；移除锚点会连同其上的物品一起移除；改标签不影响挂在上面的物品。`,
          "锚点不承载效果与后果；某个锚点要怎么才算可用（例如必须先完成某件事），写在本场景设定里，由你裁决。",
        ]
      : ["可交互锚点由内容层固定，本轮不提交、也不能修改；它们只是可供性，不是状态。"]),
    ...(canOpen ? ["打开未开启的通道用 open_passage；它不通知世界，也不改变对面场景。"] : []),
    ...(canNotify
      ? [
          "需要向世界报告时用 notify_world，写清发生了什么与需要裁决什么；只更新 environment 不会让世界知道。本场景设定明确要求报告世界的事实，必须使用 notify_world。",
        ]
      : []),
    "读完就调用 submit_stage_plan 提交；写动作与提交可以放在同一次回复里，没有改动就提交空计划。",
    "只读工具（inspect）可以在同一次回复里多次调用，不占写额度，但每一次回复都算一轮推理；本轮会写库的动作最多：environment 一次、锚点一次、通道一条、world 通知两条。",
  ];

  return `# 当前场景

## 场景
${stage.name}
${stage.profile}

## 当前环境
${stage.environment}

## 同场景角色
${actorLines}

## 可交互锚点
${describeStageAnchors(stage.anchors)}

## 可去场景
${moveLines}

## 未开启的通道
${sealedLines}

# 本轮任务

${taskLines.join("\n")}`;
}
