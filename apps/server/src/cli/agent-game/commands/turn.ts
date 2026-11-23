/**
 * 回合推进：`npc` / `stage` / `world`，以及维护入口 `appearance` / `deaths`。
 *
 * 参数与帮助在这里，推进编排在 `game-ops`：一次命令推进一层，`--all` 只是按顺序
 * 遍历同一层，不级联到下一层。
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
import { gameOption, gameRef, optionalActorOption, optionalOption } from "../../args";
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
    summary: "推进一个 / 全部未被接管的 NPC 回合",
    options: [gameOption(), optionalActorOption(), allOption()],
    schema: npcInput,
    run: async (input, ctx) => ctx.db((db) => advanceNpc(db, input.game, input, services(ctx))),
  });

  addCommand(program, ctx, {
    name: "stage",
    group: GROUP,
    summary: "推进一个 / 全部舞台回合",
    options: [gameOption(), optionalOption("--stage <ref>", "stageId 或 stageName"), allOption()],
    schema: stageInput,
    run: async (input, ctx) => ctx.db((db) => advanceStage(db, input.game, input, services(ctx))),
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
    summary: "重推外观描述",
    options: [gameOption(), optionalActorOption(), allOption()],
    schema: appearanceInput,
    run: async (input, ctx) =>
      ctx.db((db) => advanceAppearance(db, input.game, input, services(ctx))),
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
