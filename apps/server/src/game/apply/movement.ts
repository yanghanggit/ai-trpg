import { eq } from "drizzle-orm";
import { actors } from "../../db/schema";
import { GameError } from "../errors";
import { appendActionObservations, appendEnvironmentObservations } from "../observations";
import { wakeSleepingActors } from "../status";
import { appendPublicMessage, bumpGameVersion, movementFeedback } from "./messages";
import type { ActorWithStageRow, Executor, ResolvedMovement } from "./types";

async function applyMove(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedMovement,
  now: Date,
): Promise<string> {
  const targetStage = resolved.targetStage;
  if (!targetStage) {
    throw new GameError("invalid_action", "move 缺少目标场景");
  }
  await executor
    .update(actors)
    .set({ stageId: targetStage.id, updatedAt: now })
    .where(eq(actors.id, actorRow.actor.id));
  await bumpGameVersion(executor, gameId, now);
  await appendPublicMessage(executor, gameId, actorRow.actor.id, {
    kind: "move",
    stageId: targetStage.id,
    visibility: "stage",
    content: `${actorRow.actor.name}从${resolved.stage.name}走向${targetStage.name}。`,
  });
  await appendEnvironmentObservations(
    executor,
    gameId,
    targetStage.id,
    actorRow.actor.id,
    `# 环境变化\n${actorRow.actor.name}从${resolved.stage.name}进入了${targetStage.name}。`,
  );
  await wakeSleepingActors(executor, resolved.stage.id, now);
  await wakeSleepingActors(executor, targetStage.id, now);
  return movementFeedback(resolved);
}

async function applyWait(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedMovement,
  now: Date,
): Promise<string> {
  await bumpGameVersion(executor, gameId, now);
  await appendPublicMessage(executor, gameId, actorRow.actor.id, {
    kind: "wait",
    stageId: resolved.stage.id,
    visibility: "stage",
    content: `${actorRow.actor.name}留在原地，继续观察四周。`,
  });
  await appendActionObservations(
    executor,
    gameId,
    resolved.stage.id,
    actorRow.actor.id,
    `# 场景动态\n${actorRow.actor.name}留在原地，继续观察四周。`,
  );
  return movementFeedback(resolved);
}

/** 应用移动或等待；wait 不改变位置，也不唤醒沉睡者。 */
export async function applyMovement(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedMovement,
  now: Date,
): Promise<string> {
  switch (resolved.intent.mode) {
    case "move":
      return applyMove(executor, gameId, actorRow, resolved, now);
    case "wait":
      return applyWait(executor, gameId, actorRow, resolved, now);
  }
}
