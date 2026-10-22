import { visibilityForCommunication } from "../actions";
import { appendCommunicationObservations } from "../observations";
import { appendPublicMessage, bumpGameVersion, communicationFeedback } from "./messages";
import type { ActorWithStageRow, Executor, ResolvedCommunication } from "./types";

/** 应用一次沟通；公开性与记忆由沟通 mode 决定。 */
export async function applyCommunication(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedCommunication,
  now: Date,
): Promise<string> {
  await bumpGameVersion(executor, gameId, now);
  await appendPublicMessage(executor, gameId, actorRow.actor.id, {
    kind: resolved.intent.mode,
    stageId: resolved.stage.id,
    ...(resolved.targetActor ? { targetActorId: resolved.targetActor.id } : {}),
    visibility: visibilityForCommunication(resolved.intent.mode),
    content: resolved.intent.message,
  });
  await appendCommunicationObservations(
    executor,
    gameId,
    resolved.stage,
    { id: actorRow.actor.id, name: actorRow.actor.name },
    resolved.intent.mode,
    resolved.targetActor,
    resolved.intent.message,
  );
  return communicationFeedback(resolved);
}
