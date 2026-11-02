import { inArray } from "drizzle-orm";
import type { Database } from "../../db/pool";
import { actorSignatures } from "../../db/schema";
import { getGameMemories } from "../memory";
import type { NameAuditActor, NameAuditInput } from "../name-audit";
import { getGameState } from "../service";
import { listRecognitions } from "./recognitions";

/** 从数据库装载名字审计输入；只读。 */
export async function loadNameAuditInput(db: Database, gameId: string): Promise<NameAuditInput> {
  const state = await getGameState(db, gameId);
  const resolvedGameId = state.game.id;
  const actors: NameAuditActor[] = state.world.stages.flatMap((stage) =>
    stage.actors.map((actor) => ({
      id: actor.id,
      name: actor.name,
      currentSignatureId: actor.signature.id,
    })),
  );
  const actorIds = actors.map((actor) => actor.id);
  const rows =
    actorIds.length === 0
      ? []
      : await db
          .select({ id: actorSignatures.id, actorId: actorSignatures.actorId })
          .from(actorSignatures)
          .where(inArray(actorSignatures.actorId, actorIds));
  const signatures = new Map(rows.map((row) => [row.id, row]));
  for (const actor of actors) {
    signatures.set(actor.currentSignatureId, {
      id: actor.currentSignatureId,
      actorId: actor.id,
    });
  }
  const recognitions = (await listRecognitions(db, resolvedGameId)).map((row) => ({
    observerActorId: row.observerActorId,
    signatureId: row.signatureId,
  }));
  const memories = (await getGameMemories(db, resolvedGameId)).filter(
    (memory) => memory.ownerType === "actor",
  );
  return {
    actors,
    signatures: [...signatures.values()],
    recognitions,
    memories,
  };
}
