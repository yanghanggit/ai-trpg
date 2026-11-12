import type { TraceContext } from "../../debug/trace";
import type { ToolDefinition } from "../../llm/types";
import { mentionOf } from "../kernel/addressing";
import { renderAction, withAppearances } from "../kernel/observation-text";
import type { RevealAction } from "../kernel/types";
import { appendCustomStageObservation, appendStageMemory } from "../observations";
import { setActorConcealed } from "../persistence/actors";
import { appendPublicMessage } from "../persistence/game-messages";
import type { ActorWithStageRow, Executor } from "../persistence/rows";
import type { ResolvedReveal } from "../settle/types";

export function buildRevealTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "reveal",
      description:
        "把一次现身加入计划：解除隐匿，让同舞台旁人看见你。只在此刻主动走出来；执行会暴露你的动作时会自动先现身，不必单独调用。",
      parameters: { type: "object", properties: {}, required: [] },
    },
  };
}

export function parseReveal(): RevealAction {
  return { kind: "reveal" };
}

export function resolveReveal(
  stage: ResolvedReveal["stage"],
  action: RevealAction,
): ResolvedReveal {
  return { kind: "reveal", action, stage };
}

/**
 * 一次「从暗处现身」的舞台可见事实。
 *
 * 用于显式 `reveal`，以及动作本身不写给舞台的自动破隐（耳语、被察觉的窃取）。
 * 舞台广播会按观察者渲染引用；公共事件与舞台记忆仍用真名，属上帝视角与舞台全知。
 */
export async function announceReveal(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  stage: ResolvedReveal["stage"],
  trace?: TraceContext,
): Promise<void> {
  const { actor } = actorRow;
  const stageId = stage.id;
  const content = `${actor.name}从暗处现身。`;
  await appendPublicMessage(executor, gameId, actor.id, {
    kind: "reveal",
    stageId,
    visibility: "stage",
    content,
  });
  await appendCustomStageObservation(
    executor,
    gameId,
    stageId,
    actor.id,
    (_observerId, address) =>
      renderAction(
        withAppearances(`# 舞台动态\n${mentionOf(address(actor.id))}从暗处现身。`, [
          address(actor.id),
        ]),
        stageId,
      ),
    trace,
  );
  await appendStageMemory(
    executor,
    gameId,
    stageId,
    `# 舞台事件\n${content}`,
    {
      eventKind: "reveal",
    },
    trace,
  );
}

/** 显式现身：只有从隐匿变为可见时才广播；本来就在明处时是空操作。 */
export async function applyReveal(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedReveal,
  now: Date,
  trace?: TraceContext,
): Promise<string> {
  if (!actorRow.actor.concealed) {
    return "你本来就在明处。";
  }
  await setActorConcealed(executor, actorRow.actor.id, false, now);
  actorRow.actor.concealed = false;
  await announceReveal(executor, gameId, actorRow, resolved.stage, trace);
  return "你从暗处现身。";
}
