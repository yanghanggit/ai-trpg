import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "../../db/pool";
import { users } from "../../db/schema";
import { dumpSystemPrompts } from "../../debug/prompt-dump";
import type { Logger } from "../../logging";
import { GameError } from "../errors";
import { getGameState } from "../game-state";
import type { GameState } from "../kernel/types";
import { parseWorldContent } from "../world-definition";
import { bindSignatureNames, bindVisitedStages, createActors } from "./actors";
import { buildFunctionPromptDumps } from "./prompts";
import { resolveSlug } from "./slug";
import { createConnections, createStages } from "./stages";
import type { CreateGameInput, PromptDump } from "./types";
import { createGameWorld } from "./world";

/**
 * 建局：把内容模板写成数据库状态，并导出这一次生成的 system prompt。
 *
 * 整局在一个事务里建完；prompt 导出在事务之后，失败不影响已建好的局。
 * 内容层的不变量在 `parseWorldContent` 里已经跑过，这里只做物化。
 */
export async function createGame(
  db: Database,
  input: CreateGameInput,
  options: { logger?: Logger } = {},
): Promise<GameState> {
  const world = parseWorldContent(input.world);
  const gameId = randomUUID();
  const gameName = input.name?.trim() || world.worldName;
  const slug = resolveSlug(input, gameId, gameName);

  // 建局时收集最终 system prompt，事务提交后导出为人类可读的 md。
  const stagePrompts: PromptDump[] = [];
  const actorPrompts: PromptDump[] = [];
  let worldPrompt = "";

  await db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.username, input.username)).limit(1);
    if (!user) {
      throw new GameError("not_found", `用户不存在: ${input.username}`);
    }

    const created = await createGameWorld(tx, {
      gameId,
      ownerId: user.id,
      slug,
      name: gameName,
      world,
    });
    worldPrompt = created.prompt;

    const stages = await createStages(tx, { gameId, worldId: created.worldId, world });
    stagePrompts.push(...stages.prompts);
    await createConnections(tx, { worldId: created.worldId, world, stageIds: stages.stageIds });

    // 建局是一次写入：外观与起始到访共享同一个时间戳，免得同一批数据出现先后差异。
    const actors = await createActors(tx, {
      gameId,
      worldId: created.worldId,
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
    functionPromptDumps: buildFunctionPromptDumps(world),
    stagePrompts,
    actorPrompts,
    ...(options.logger ? { logger: options.logger } : {}),
  });

  return getGameState(db, gameId);
}

export type { CreateGameInput } from "./types";
