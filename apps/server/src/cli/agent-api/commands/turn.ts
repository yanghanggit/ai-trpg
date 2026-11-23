/**
 * 回合推进：与 `agent-game` 同名同参数；一次请求推进一层，不级联。
 */

import type { Command } from "commander";
import { z } from "zod";
import { gameOption, optionalActorOption, optionalOption } from "../../args";
import { addApiCommand } from "../command";

const GROUP = "回合推进";

const allOption = () => optionalOption("--all", "对同类实体逐个执行");

const npcInput = z
  .object({
    game: z.string(),
    actor: z.string().trim().min(1).optional(),
    all: z.boolean().default(false),
  })
  .refine((input) => input.all || input.actor !== undefined, {
    message: "npc 需要 --actor <actorName>，或使用 --all",
  });

const stageInput = z
  .object({
    game: z.string(),
    stage: z.string().trim().min(1).optional(),
    all: z.boolean().default(false),
  })
  .refine((input) => input.all || input.stage !== undefined, {
    message: "stage 需要 --stage <stageId|stageName>，或使用 --all",
  });

const appearanceInput = z
  .object({
    game: z.string(),
    actor: z.string().trim().min(1).optional(),
    all: z.boolean().default(false),
  })
  .refine((input) => input.all || input.actor !== undefined, {
    message: "appearance 需要 --actor <actorName>，或使用 --all",
  });

const gameOnly = z.object({ game: z.string() });

export function registerTurnCommands(program: Command): void {
  addApiCommand(program, {
    name: "npc",
    group: GROUP,
    summary: "推进一个 / 全部未被接管的 NPC 回合",
    options: [gameOption(), optionalActorOption(), allOption()],
    schema: npcInput,
    run: async (input, client) =>
      (await client.call({
        method: "POST",
        path: `/games/${encodeURIComponent(input.game)}/turns/npc`,
        body: { actor: input.actor, all: input.all },
      })) as Record<string, unknown>,
  });

  addApiCommand(program, {
    name: "stage",
    group: GROUP,
    summary: "推进一个 / 全部舞台回合",
    options: [gameOption(), optionalOption("--stage <ref>", "stageId 或 stageName"), allOption()],
    schema: stageInput,
    run: async (input, client) =>
      (await client.call({
        method: "POST",
        path: `/games/${encodeURIComponent(input.game)}/turns/stage`,
        body: { stage: input.stage, all: input.all },
      })) as Record<string, unknown>,
  });

  addApiCommand(program, {
    name: "world",
    group: GROUP,
    summary: "推进 world 回合（读取 stage 通知并裁决）",
    options: [gameOption()],
    schema: gameOnly,
    run: async (input, client) =>
      (await client.call({
        method: "POST",
        path: `/games/${encodeURIComponent(input.game)}/turns/world`,
        body: {},
      })) as Record<string, unknown>,
  });

  addApiCommand(program, {
    name: "appearance",
    group: GROUP,
    summary: "重推外观描述",
    options: [gameOption(), optionalActorOption(), allOption()],
    schema: appearanceInput,
    run: async (input, client) =>
      (await client.call({
        method: "POST",
        path: `/games/${encodeURIComponent(input.game)}/turns/appearance`,
        body: { actor: input.actor, all: input.all },
      })) as Record<string, unknown>,
  });

  addApiCommand(program, {
    name: "deaths",
    group: GROUP,
    summary: "对每个 hp 归零且未收尾的 actor 跑一次死亡阶段",
    options: [gameOption()],
    schema: gameOnly,
    run: async (input, client) =>
      (await client.call({
        method: "POST",
        path: `/games/${encodeURIComponent(input.game)}/turns/deaths`,
        body: {},
      })) as Record<string, unknown>,
  });
}
