/**
 * 回合推进：与 `agent-game` 同名同参数；一次请求推进一层，不级联。
 */

import type { Command } from "commander";
import { z } from "zod";
import { gameOption, requiredOption } from "../../args";
import { addApiCommand } from "../command";

const GROUP = "回合推进";

const npcInput = z.object({
  game: z.string(),
  actor: z.array(z.string().trim().min(1)).min(1, "需要至少一个 --actor <actorName>"),
});

const stageInput = z.object({
  game: z.string(),
  stage: z.array(z.string().trim().min(1)).min(1, "需要至少一个 --stage <stageId|stageName>"),
});

const appearanceInput = z.object({
  game: z.string(),
  actor: z.array(z.string().trim().min(1)).min(1, "需要至少一个 --actor <actorName>"),
});

const gameOnly = z.object({ game: z.string() });

export function registerTurnCommands(program: Command): void {
  addApiCommand(program, {
    name: "npc",
    group: GROUP,
    summary: "按给定名单逐个推进 NPC 回合",
    options: [
      gameOption(),
      requiredOption("--actor <names...>", "actor 名称，可重复用或一次给多个"),
    ],
    schema: npcInput,
    run: async (input, client) =>
      (await client.call({
        method: "POST",
        path: `/games/${encodeURIComponent(input.game)}/turns/npc`,
        body: { actors: input.actor },
      })) as Record<string, unknown>,
  });

  addApiCommand(program, {
    name: "stage",
    group: GROUP,
    summary: "按给定名单逐个推进舞台回合",
    options: [
      gameOption(),
      requiredOption("--stage <refs...>", "stageId 或 stageName，可重复用或一次给多个"),
    ],
    schema: stageInput,
    run: async (input, client) =>
      (await client.call({
        method: "POST",
        path: `/games/${encodeURIComponent(input.game)}/turns/stage`,
        body: { stages: input.stage },
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
    summary: "按给定名单逐个重推外观（活人重算 / 尸体刷死亡外观）",
    options: [
      gameOption(),
      requiredOption("--actor <names...>", "actor 名称，可重复用或一次给多个"),
    ],
    schema: appearanceInput,
    run: async (input, client) =>
      (await client.call({
        method: "POST",
        path: `/games/${encodeURIComponent(input.game)}/turns/appearance`,
        body: { actors: input.actor },
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
