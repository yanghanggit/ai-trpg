/**
 * 回合推进：`npc` / `stage` / `world`，以及维护入口 `appearance` / `deaths`。
 *
 * 不自动编排回合：一次命令推进一层，`--all` 只是按顺序遍历同一层，不级联到下一层。
 */

import type { Command } from "commander";
import { z } from "zod";
import type { Database } from "../../../db/pool";
import { DEEPSEEK_SERVICE } from "../../../deepseek";
import {
  findActorByName,
  getGameState,
  isAlive,
  listPlayerControlledActorIds,
  rebuildAppearance,
  refreshCorpseAppearance,
  runActorTurn,
  runStageTurn,
  runWorldTurn,
  settleDeaths,
  updateAppearance,
} from "../../../game";
import { listActorsForAppearance } from "../../../game/persistence/actors";
import type { ActorTurnResult, StageTurnResult, WorldTurnResult } from "../../../game/types";
import type { ChatCompletionService } from "../../../llm/protocol";
import type { Logger } from "../../../logging";
import { gameOption, gameRef, optionalActorOption, optionalOption } from "../args";
import { addCommand } from "../command";
import type { CommandContext } from "../context";

const GROUP = "回合推进";

const allOption = () => optionalOption("--all", "对同类实体逐个执行");

export type AppearanceRefreshOptions = {
  service: ChatCompletionService;
  logger?: Logger;
};

export type AppearanceRefreshResult = {
  /** 本次重推了外观的活人。 */
  refreshed: string[];
  /** 跳过的尸体：它们的外观由死亡阶段负责。 */
  skippedCorpses: string[];
};

/**
 * 批量重推外观：活人各推一次，尸体一律跳过。
 *
 * 尸体外观属于死亡阶段——那时才有尸体描写，也需要收尾标记保证只写一次；这里重推会绕过
 * 那份幂等。想让整局「外观与死亡都跟当前状态一致」的是调试入口，它在这之后接着跑死亡阶段。
 *
 * 住在 CLI 是因为它只服务这一个维护命令：读全表、按生命状态分流，是最高层的编排；
 * `appearance/` 只管被点名的活人，尸体走 `death/` 的收尾能力。
 */
export async function refreshAppearances(
  db: Database,
  gameId: string,
  options: AppearanceRefreshOptions,
): Promise<AppearanceRefreshResult> {
  const result: AppearanceRefreshResult = { refreshed: [], skippedCorpses: [] };

  for (const row of await listActorsForAppearance(db, gameId)) {
    if (row.hp <= 0) {
      result.skippedCorpses.push(row.name);
      continue;
    }
    const appearance = await rebuildAppearance(db, gameId, row.name, {
      service: options.service,
      ...(options.logger ? { logger: options.logger } : {}),
    });
    if (appearance.ok) {
      result.refreshed.push(row.name);
    } else {
      options.logger?.warn(`外观重推失败: ${row.name}`);
    }
  }

  return result;
}

const npcInput = z
  .object({
    game: gameRef,
    actor: z.string().trim().min(1).optional(),
    all: z.boolean().default(false),
  })
  .refine((input) => input.all || input.actor !== undefined, {
    message: "npc 需要 --actor <actorName>，或使用 --all",
  });

const stageInput = z
  .object({
    game: gameRef,
    stage: z.string().trim().min(1).optional(),
    all: z.boolean().default(false),
  })
  .refine((input) => input.all || input.stage !== undefined, {
    message: "stage 需要 --stage <stageId|stageName>，或使用 --all",
  });

const appearanceInput = z
  .object({
    game: gameRef,
    actor: z.string().trim().min(1).optional(),
    all: z.boolean().default(false),
  })
  .refine((input) => input.all || input.actor !== undefined, {
    message: "appearance 需要 --actor <actorName>，或使用 --all",
  });

/**
 * 回合输出不内联整份事件流：只给活状态与游标，需要事件时用 `messages --after <cursor>`。
 */
function npcOutput(result: ActorTurnResult): Record<string, unknown> {
  return {
    ok: result.ok,
    plan: result.plan,
    loopSuccess: result.loopSuccess,
    state: result.state,
    messageCursor: result.messageCursor,
    ...(result.death === undefined ? {} : { death: result.death }),
  };
}

function stageOutput(result: StageTurnResult): Record<string, unknown> {
  return {
    ok: result.ok,
    plan: result.plan,
    loopSuccess: result.loopSuccess,
    state: result.state,
    messageCursor: result.messageCursor,
  };
}

function worldOutput(result: WorldTurnResult): Record<string, unknown> {
  return {
    ok: result.ok,
    plan: result.plan,
    loopSuccess: result.loopSuccess,
    state: result.state,
    messageCursor: result.messageCursor,
  };
}

export function registerTurnCommands(program: Command, ctx: CommandContext): void {
  addCommand(program, ctx, {
    name: "npc",
    group: GROUP,
    summary: "推进一个 / 全部未被接管的 NPC 回合",
    options: [gameOption(), optionalActorOption(), allOption()],
    schema: npcInput,
    run: async (input, ctx) => {
      const results = await ctx.db(async (db) => {
        const services = {
          service: DEEPSEEK_SERVICE,
          inferenceService: DEEPSEEK_SERVICE,
          logger: ctx.log(),
        };
        if (!input.all && input.actor !== undefined) {
          return [await runActorTurn(db, input.game, input.actor, services)];
        }
        const state = await getGameState(db, input.game);
        const controlled = new Set(await listPlayerControlledActorIds(db, state.game.id));
        const actors = state.world.stages
          .flatMap((stage) => stage.actors.filter(isAlive))
          .filter((actor) => !controlled.has(actor.id));
        const output: ActorTurnResult[] = [];
        for (const actor of actors) {
          output.push(await runActorTurn(db, input.game, actor.name, services));
        }
        return output;
      });
      return { results: results.map(npcOutput) };
    },
  });

  addCommand(program, ctx, {
    name: "stage",
    group: GROUP,
    summary: "推进一个 / 全部场景回合",
    options: [gameOption(), optionalOption("--stage <ref>", "stageId 或 stageName"), allOption()],
    schema: stageInput,
    run: async (input, ctx) => {
      const results = await ctx.db(async (db) => {
        if (!input.all && input.stage !== undefined) {
          return [await runStageTurn(db, input.game, input.stage, { service: DEEPSEEK_SERVICE })];
        }
        const state = await getGameState(db, input.game);
        const output: StageTurnResult[] = [];
        for (const stage of state.world.stages) {
          output.push(await runStageTurn(db, input.game, stage.id, { service: DEEPSEEK_SERVICE }));
        }
        return output;
      });
      return { results: results.map(stageOutput) };
    },
  });

  addCommand(program, ctx, {
    name: "world",
    group: GROUP,
    summary: "推进 world 回合（读取 stage 通知并裁决）",
    options: [gameOption()],
    schema: z.object({ game: gameRef }),
    run: async (input, ctx) =>
      worldOutput(
        await ctx.db((db) => runWorldTurn(db, input.game, { service: DEEPSEEK_SERVICE })),
      ),
  });

  addCommand(program, ctx, {
    name: "appearance",
    group: GROUP,
    summary: "重推外观描述",
    options: [gameOption(), optionalActorOption(), allOption()],
    schema: appearanceInput,
    run: async (input, ctx) => {
      // --all 是批量维护：活人重推，随后把未收尾的死者交给死亡阶段。
      // --actor 是单点干预：活人走外观入口，尸体走死亡阶段的尸体刷新（不写收尾标记）。
      if (input.all || input.actor === undefined) {
        return ctx.db(async (db) => {
          const state = await getGameState(db, input.game);
          const refreshed = await refreshAppearances(db, state.game.id, {
            service: DEEPSEEK_SERVICE,
          });
          const death = await settleDeaths(db, state.game.id, { service: DEEPSEEK_SERVICE });
          return { ...refreshed, ...death };
        });
      }
      const actor = input.actor;
      const result = await ctx.db(async (db) => {
        const state = await getGameState(db, input.game);
        const target = findActorByName(state, actor).actor;
        const options = { service: DEEPSEEK_SERVICE };
        return isAlive(target)
          ? updateAppearance(db, input.game, actor, options)
          : refreshCorpseAppearance(db, input.game, actor, options);
      });
      // 单点推送的成败由 payload 的 ok 表达，命令本身不失败（与批量入口一致）。
      return { ok: result.ok, actor, appearance: result.appearance };
    },
  });

  addCommand(program, ctx, {
    name: "deaths",
    group: GROUP,
    summary: "对每个 hp 归零且未收尾的 actor 跑一次死亡阶段",
    options: [gameOption()],
    schema: z.object({ game: gameRef }),
    run: async (input, ctx) =>
      ctx.db(async (db) => {
        const state = await getGameState(db, input.game);
        // 外观失败按设计可以不管，所以 ok 只看死亡是否宣布成功。
        return { ...(await settleDeaths(db, state.game.id, { service: DEEPSEEK_SERVICE })) };
      }),
  });
}
