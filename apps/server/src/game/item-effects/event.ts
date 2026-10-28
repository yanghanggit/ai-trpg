import { appendPublicMessage, bumpGameVersion } from "../apply/messages";
import { appendItemObservations, appendStageMemory } from "../observations";
import type { ItemEffectHandler } from "./types";

/** 事件效果：只记录“谁在何处对谁使用了什么”，后果交给 stage/world。 */
export const applyEventEffect: ItemEffectHandler = async (context) => {
  const { executor, gameId, actorRow, stage, item, target, targetStage, targetDetail, now } =
    context;
  if (!item) {
    throw new Error("event effect 需要物品");
  }
  const actor = { id: actorRow.actor.id, name: actorRow.actor.name };
  const targetLabel = targetStage?.name ?? target?.name ?? "目标";
  const stageDetailText = targetDetail ? `的${targetDetail}` : "";
  const content = targetStage
    ? `${actor.name}在${targetStage.name}${stageDetailText}使用了${item.name}。`
    : `${actor.name}对${targetLabel}使用了${item.name}。`;

  await bumpGameVersion(executor, gameId, now);
  await appendPublicMessage(executor, gameId, actor.id, {
    kind: "use",
    stageId: stage.id,
    ...(target ? { targetActorId: target.id } : {}),
    visibility: "stage",
    content,
  });
  await appendItemObservations(executor, gameId, stage, {
    actor,
    itemName: item.name,
    event: "use",
    ...(target ? { target: { id: target.id, name: target.name } } : {}),
    ...(targetStage ? { targetStageName: targetStage.name } : {}),
    ...(targetDetail ? { targetDetail } : {}),
  });
  await appendStageMemory(executor, gameId, stage.id, `# 场景事件\n${content}`, {
    eventKind: "use",
    ...(target ? { targetActorId: target.id } : {}),
    ...(targetStage ? { targetStageId: targetStage.id } : {}),
  });

  return targetStage
    ? `# 行动结果\n你在${targetLabel}${stageDetailText}使用了${item.name}。`
    : `# 行动结果\n你对${targetLabel}使用了${item.name}。`;
};
