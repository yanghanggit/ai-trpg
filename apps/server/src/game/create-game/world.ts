import { randomUUID } from "node:crypto";
import { gamePlayers, games, worlds } from "../../db/schema";
import { buildWorldSystemPrompt, createWorldMemory } from "../memory";
import { allocateEntitySeq } from "../persistence/entity-seq";
import type { Executor } from "../persistence/rows";
import type { World } from "../world-definition";

/**
 * 建局的根：game 行、player 行、world 行与 world 记忆。
 *
 * 先有这三行，舞台与角色才有挂载点；world 的 system prompt 同时返回，供建局后导出。
 */
export async function createGameWorld(
  tx: Executor,
  input: { gameId: string; ownerId: string; slug: string; name: string; world: World },
): Promise<{ playerId: string; worldId: string; prompt: string }> {
  const { gameId, ownerId, slug, name, world } = input;
  const playerId = randomUUID();
  const worldId = randomUUID();

  await tx.insert(games).values({
    id: gameId,
    ownerId,
    slug,
    name,
    status: "active",
    contentVersion: world.contentVersion,
    version: 0,
  });
  await tx.insert(gamePlayers).values({ id: playerId, gameId, userId: ownerId, role: "player" });
  await tx.insert(worlds).values({
    id: worldId,
    seq: await allocateEntitySeq(tx, gameId),
    gameId,
    name: world.worldName,
    contentKey: world.contentKey,
    profile: world.profile,
    campaignSetting: world.campaignSetting,
    globalRules: world.globalRules,
    functionPrompts: world.functionPrompts,
    actions: [...world.actions],
  });

  const prompt = buildWorldSystemPrompt(world);
  await createWorldMemory(
    tx,
    gameId,
    {
      id: worldId,
      worldName: world.worldName,
      campaignSetting: world.campaignSetting,
      globalRules: world.globalRules,
    },
    prompt,
  );
  return { playerId, worldId, prompt };
}
