import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "../../db/pool";
import { gamePlayers, games, users, worlds } from "../../db/schema";
import { dumpSystemPrompts } from "../../debug/prompt-dump";
import type { Logger } from "../../logging";
import { GameError } from "../errors";
import { buildWorldSystemPrompt, createWorldMemory } from "../memory";
import { parseWorldContent } from "../parse-world-content";
import { allocateEntitySeq } from "../persistence/entity-seq";
import { getGameState } from "../read/game-state";
import type { GameState } from "../types";
import { bindSignatureNames, bindVisitedStages, createActors } from "./actors";
import { buildFunctionAgentPrompts } from "./prompts";
import { createConnections, createStages } from "./stages";
import type { CreateGameInput, PromptDump } from "./types";
import { assertUniqueActorKeys, assertUniqueItemKeys, resolveSlug } from "./validate";

/**
 * 建局：把内容模板写成数据库状态，并导出这一次生成的 system prompt。
 *
 * 整局在一个事务里建完；prompt 导出在事务之后，失败不影响已建好的局。
 */
/** 创建一局游戏及初始 world、stage、actor、item 与 memory。 */
export async function createGame(
  db: Database,
  input: CreateGameInput,
  options: { logger?: Logger } = {},
): Promise<GameState> {
  const world = parseWorldContent(input.world);
  const gameId = randomUUID();
  const gameName = input.name?.trim() || world.worldName;
  const slug = resolveSlug(input, gameId, gameName);
  const worldPrompt = buildWorldSystemPrompt(world);

  // 建局时收集最终 system prompt，事务提交后导出为人类可读的 md。
  const stagePrompts: PromptDump[] = [];
  const actorPrompts: PromptDump[] = [];

  await db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.username, input.username)).limit(1);
    if (!user) {
      throw new GameError("not_found", `用户不存在: ${input.username}`);
    }
    const playerId = randomUUID();
    const worldId = randomUUID();

    await tx.insert(games).values({
      id: gameId,
      ownerId: user.id,
      slug,
      name: gameName,
      status: "active",
      contentVersion: world.contentVersion,
      version: 0,
    });
    await tx.insert(gamePlayers).values({ id: playerId, gameId, userId: user.id, role: "player" });
    await tx.insert(worlds).values({
      id: worldId,
      seq: await allocateEntitySeq(tx, gameId),
      gameId,
      name: world.worldName,
      contentKey: world.contentKey,
      profile: world.profile,
      campaignSetting: world.campaignSetting,
      globalRules: world.globalRules,
      functionAgents: world.functionAgents,
      actions: [...world.actions],
    });
    await createWorldMemory(
      tx,
      gameId,
      {
        id: worldId,
        worldName: world.worldName,
        campaignSetting: world.campaignSetting,
        globalRules: world.globalRules,
      },
      worldPrompt,
    );

    const stages = await createStages(tx, { gameId, worldId, world });
    stagePrompts.push(...stages.prompts);
    assertUniqueItemKeys(world);
    assertUniqueActorKeys(world);
    await createConnections(tx, { worldId, world, stageIds: stages.stageIds });

    // 建局是一次写入：外观与起始到访共享同一个时间戳，免得同一批数据出现先后差异。
    const actors = await createActors(tx, {
      gameId,
      worldId,
      world,
      stageIds: stages.stageIds,
      now: new Date(),
    });
    actorPrompts.push(...actors.prompts);
    await bindSignatureNames(tx, { gameId, world, actorRefs: actors.actorRefs });
    await bindVisitedStages(tx, {
      gameId,
      world,
      stageIds: stages.stageIds,
      actorRefs: actors.actorRefs,
      now: new Date(),
    });
  });

  await dumpSystemPrompts({
    world: { name: world.worldName, contentVersion: world.contentVersion },
    worldPrompt,
    functionAgentPrompts: buildFunctionAgentPrompts(world),
    stagePrompts,
    actorPrompts,
    ...(options.logger ? { logger: options.logger } : {}),
  });

  return getGameState(db, gameId);
}
