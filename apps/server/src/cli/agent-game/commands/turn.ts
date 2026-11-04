/**
 * 回合推进：`npc` / `stage` / `world`，以及维护入口 `appearance` / `deaths`。
 *
 * 不自动编排回合：一次命令推进一层，`--all` 只是按顺序遍历同一层，不级联到下一层。
 */

import type { Command } from "commander";
import { z } from "zod";
import { DEEPSEEK_SERVICE } from "../../../deepseek";
import {
  getGameState,
  isAlive,
  listPlayerControlledActorIds,
  refreshAppearances,
  runAppearanceTurn,
  runNpcTurn,
  runStageTurn,
  runWorldTurn,
  settleDeaths,
} from "../../../game";
import type { ActorTurnResult, StageTurnResult, WorldTurnResult } from "../../../game/types";
import { gameOption, gameRef, optionalActorOption, optionalOption } from "../args";
import { addCommand } from "../command";
import type { CommandContext } from "../context";

const GROUP = "回合推进";

const allOption = () => optionalOption("--all", "对同类实体逐个执行");

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
          appearanceService: DEEPSEEK_SERVICE,
          logger: ctx.log(),
        };
        if (!input.all && input.actor !== undefined) {
          return [await runNpcTurn(db, input.game, input.actor, services)];
        }
        const state = await getGameState(db, input.game);
        const controlled = new Set(await listPlayerControlledActorIds(db, state.game.id));
        const actors = state.world.stages
          .flatMap((stage) => stage.actors.filter(isAlive))
          .filter((actor) => !controlled.has(actor.id));
        const output: ActorTurnResult[] = [];
        for (const actor of actors) {
          output.push(await runNpcTurn(db, input.game, actor.name, services));
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
      // --all 是批量维护：活人重推、未收尾的死者收尾、已收尾的尸体跳过。
      // --actor 是单点干预：强制重推，尸体也照推（不写收尾标记）。
      if (input.all || input.actor === undefined) {
        return ctx.db(async (db) => {
          const state = await getGameState(db, input.game);
          return refreshAppearances(db, state.game.id, { service: DEEPSEEK_SERVICE });
        });
      }
      const actor = input.actor;
      const result = await ctx.db((db) =>
        runAppearanceTurn(db, input.game, actor, { service: DEEPSEEK_SERVICE }),
      );
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
