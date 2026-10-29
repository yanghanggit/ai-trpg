import { inArray } from "drizzle-orm";
import type { Database } from "../../db/pool";
import { actorPresentations } from "../../db/schema";
import { getGameMemories } from "../memory";
import type { NameAuditActor, NameAuditInput } from "../name-audit";
import { getGameState } from "../service";
import { listKnowledge } from "./knowledge";

/** 从数据库装载名字审计输入；只读。 */
export async function loadNameAuditInput(db: Database, gameId: string): Promise<NameAuditInput> {
  const state = await getGameState(db, gameId);
  const resolvedGameId = state.game.id;
  const actors: NameAuditActor[] = state.world.stages.flatMap((stage) =>
    stage.actors.map((actor) => ({
      id: actor.id,
      name: actor.name,
      currentPresentationId: actor.presentation.id,
    })),
  );
  const actorIds = actors.map((actor) => actor.id);
  const rows =
    actorIds.length === 0
      ? []
      : await db
          .select({ id: actorPresentations.id, actorId: actorPresentations.actorId })
          .from(actorPresentations)
          .where(inArray(actorPresentations.actorId, actorIds));
  const presentations = new Map(rows.map((row) => [row.id, row]));
  for (const actor of actors) {
    presentations.set(actor.currentPresentationId, {
      id: actor.currentPresentationId,
      actorId: actor.id,
    });
  }
  const knowledge = (await listKnowledge(db, resolvedGameId)).map((row) => ({
    observerActorId: row.observerActorId,
    presentationId: row.presentationId,
    name: row.name,
  }));
  const memories = (await getGameMemories(db, resolvedGameId)).filter(
    (memory) => memory.ownerType === "actor",
  );
  return {
    actors,
    presentations: [...presentations.values()],
    knowledge,
    memories,
  };
}
