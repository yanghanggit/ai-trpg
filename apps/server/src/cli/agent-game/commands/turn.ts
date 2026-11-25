/**
 * 回合推进：`npc` / `stage` / `world`，以及维护入口 `appearance` / `deaths`。
 *
 * 参数与帮助在这里，推进编排在 `game-ops`：一次命令推进一层，不级联到下一层。
 *
 * `npc` / `stage` / `appearance` 只吃显式名单，没有 `--all`：引擎不代选目标，也不推荐
 * 「一把推完」。想推一群就把名字都列出来——调用方自己承担后果：列表越长跑得越久、
 * 每人一轮模型调用、中途撞上已死 / 已被接管 / 缺 memory 的实体会直接失败（已完成的
 * 那几轮已经落账）。
 */

import type { Command } from "commander";
import { z } from "zod";
import { DEEPSEEK_SERVICE } from "../../../deepseek";
import {
  advanceAppearance,
  advanceNpc,
  advanceStage,
  advanceWorld,
  settleDeaths,
} from "../../../game-ops";
import { gameOption, gameRef, optionalOption, requiredOption } from "../../args";
import { addCommand } from "../command";
import type { CommandContext } from "../context";

const GROUP = "回合推进";

const npcInput = z.object({
  game: gameRef,
  actor: z.array(z.string().trim().min(1)).min(1, "需要至少一个 --actor <actorName>"),
  expectedVersion: z.coerce.number().int().min(0).optional(),
});

const stageInput = z.object({
  game: gameRef,
  stage: z.array(z.string().trim().min(1)).min(1, "需要至少一个 --stage <stageId|stageName>"),
});

const appearanceInput = z.object({
  game: gameRef,
  actor: z.array(z.string().trim().min(1)).min(1, "需要至少一个 --actor <actorName>"),
});

/** 回合类命令共用同一组依赖：计划与增量都走默认实例，日志走 stderr。 */
function services(ctx: CommandContext) {
  return {
    service: DEEPSEEK_SERVICE,
    inferenceService: DEEPSEEK_SERVICE,
    logger: ctx.log(),
  };
}

export function registerTurnCommands(program: Command, ctx: CommandContext): void {
  addCommand(program, ctx, {
    name: "npc",
    group: GROUP,
    summary: "按给定名单逐个推进 NPC 回合",
    options: [
      gameOption(),
      requiredOption("--actor <names...>", "actor 名称，可重复用或一次给多个"),
      optionalOption(
        "--expected-version <n>",
        "你读到的那份视图的版本；给了就要求一致，不一致即 409",
      ),
    ],
    schema: npcInput,
    run: async (input, ctx) =>
      ctx.db((db) =>
        advanceNpc(
          db,
          input.game,
          {
            actors: input.actor,
            ...(input.expectedVersion === undefined
              ? {}
              : { expectedVersion: input.expectedVersion }),
          },
          services(ctx),
        ),
      ),
  });

  addCommand(program, ctx, {
    name: "stage",
    group: GROUP,
    summary: "按给定名单逐个推进舞台回合",
    options: [
      gameOption(),
      requiredOption("--stage <refs...>", "stageId 或 stageName，可重复用或一次给多个"),
    ],
    schema: stageInput,
    run: async (input, ctx) =>
      ctx.db((db) => advanceStage(db, input.game, { stages: input.stage }, services(ctx))),
  });

  addCommand(program, ctx, {
    name: "world",
    group: GROUP,
    summary: "推进 world 回合（读取 stage 通知并裁决）",
    options: [gameOption()],
    schema: z.object({ game: gameRef }),
    run: async (input, ctx) => ctx.db((db) => advanceWorld(db, input.game, services(ctx))),
  });

  addCommand(program, ctx, {
    name: "appearance",
    group: GROUP,
    summary: "按给定名单逐个重推外观（活人重算 / 尸体刷死亡外观）",
    options: [
      gameOption(),
      requiredOption("--actor <names...>", "actor 名称，可重复用或一次给多个"),
    ],
    schema: appearanceInput,
    run: async (input, ctx) =>
      ctx.db((db) => advanceAppearance(db, input.game, { actors: input.actor }, services(ctx))),
  });

  addCommand(program, ctx, {
    name: "deaths",
    group: GROUP,
    summary: "对每个 hp 归零且未收尾的 actor 跑一次死亡阶段",
    options: [gameOption()],
    schema: z.object({ game: gameRef }),
    run: async (input, ctx) => ctx.db((db) => settleDeaths(db, input.game, services(ctx))),
  });
}
