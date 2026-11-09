import type { TraceContext } from "../../debug/trace";
import { type AddressLookup, actionRef } from "../addressing";
import { appendPublicMessage, bumpGameVersion } from "../apply/messages";
import type { ActorRow, ActorWithStageRow, Executor, StageRow } from "../apply/types";
import { appendItemObservations, appendStageMemory } from "../observations";

export type UseEventInput = {
  executor: Executor;
  gameId: string;
  actorRow: ActorWithStageRow;
  stage: StageRow;
  item: { name: string };
  target?: ActorRow;
  targetStage?: StageRow;
  targetAnchor?: string;
  now: Date;
  address?: AddressLookup;
  trace?: TraceContext;
};

/**
 * `use` 的基础事件：引擎行为，不依赖词缀。
 *
 * 没有词缀的物品也可能被“使用”（例如把钟舌放回祭坛），这条记录保证动作在世界里
 * 留下痕迹；可见后果由 witness 额外追加。
 */
export async function applyUseEvent(input: UseEventInput): Promise<string> {
  const { executor, gameId, actorRow, stage, item, target, targetStage, targetAnchor, now, trace } =
    input;
  const actor = { id: actorRow.actor.id, name: actorRow.actor.name };
  const targetRef = target && input.address ? actionRef(input.address(target.id)) : undefined;
  const targetLabel = targetStage ? targetStage.name : (targetRef ?? target?.name ?? "目标");
  const stageAnchorText = targetAnchor ? `的${targetAnchor}` : "";
  const content = targetStage
    ? `${actor.name}在${targetStage.name}${stageAnchorText}使用了${item.name}。`
    : `${actor.name}对${targetLabel}使用了${item.name}。`;

  await bumpGameVersion(executor, gameId, now);
  await appendPublicMessage(executor, gameId, actor.id, {
    kind: "use",
    stageId: stage.id,
    ...(target ? { targetActorId: target.id } : {}),
    visibility: "stage",
    content,
  });
  await appendItemObservations(
    executor,
    gameId,
    stage,
    {
      actor,
      itemName: item.name,
      event: "use",
      ...(target ? { target: { id: target.id } } : {}),
      ...(targetStage ? { targetStageName: targetStage.name } : {}),
      ...(targetAnchor ? { targetAnchor } : {}),
    },
    trace,
  );
  await appendStageMemory(
    executor,
    gameId,
    stage.id,
    `# 场景事件\n${content}`,
    {
      eventKind: "use",
      ...(target ? { targetActorId: target.id } : {}),
      ...(targetStage ? { targetStageId: targetStage.id } : {}),
    },
    trace,
  );

  return targetStage
    ? `# 行动结果\n你在${targetLabel}${stageAnchorText}使用了${item.name}。`
    : `# 行动结果\n你对${targetLabel}使用了${item.name}。`;
}
