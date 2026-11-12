import type { ToolDefinition } from "../../llm/types";
import type { HideAction } from "../kernel/types";
import { setActorConcealed } from "../persistence/actors";
import type { ActorWithStageRow, Executor } from "../persistence/rows";
import type { ResolvedHide } from "../settle/types";

export function buildHideTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "hide",
      description:
        "把一次隐匿加入计划：旁人不再被动看见你。移动、传送、等待、换装、查看与远端传话不会暴露你；说话、攻击、递物、拾取、搜刮、使用、对上会先暴露你。",
      parameters: { type: "object", properties: {}, required: [] },
    },
  };
}

export function parseHide(): HideAction {
  return { kind: "hide" };
}

export function resolveHide(stage: ResolvedHide["stage"], action: HideAction): ResolvedHide {
  return { kind: "hide", action, stage };
}

/** 隐入暗处是静默状态转移：不写公共事件、舞台记忆或旁人观察。 */
export async function applyHide(
  executor: Executor,
  actorRow: ActorWithStageRow,
  now: Date,
): Promise<string> {
  if (actorRow.actor.concealed) {
    return "你已经在隐匿中。";
  }
  await setActorConcealed(executor, actorRow.actor.id, true, now);
  actorRow.actor.concealed = true;
  return `你隐入暗处，旁人暂时看不见你。`;
}
