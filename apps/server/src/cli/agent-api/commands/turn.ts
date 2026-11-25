/**
 * 回合推进：与 `agent-game` 同名同参数；一次请求推进一层，不级联。
 */

import type { Command } from "commander";
import { z } from "zod";
import { gameOption, optionalOption, requiredOption } from "../../args";
import { addApiCommand } from "../command";
import { runTurnJob, type TurnJob } from "../jobs";

const GROUP = "回合推进";

const npcInput = z.object({
  game: z.string(),
  actor: z.array(z.string().trim().min(1)).min(1, "需要至少一个 --actor <actorName>"),
  expectedVersion: z.coerce.number().int().min(0).optional(),
});

const passInput = z.object({
  game: z.string(),
  actor: z.array(z.string().trim().min(1)).min(1, "需要至少一个 --actor <actorName>"),
});

const stageInput = z.object({
  game: z.string(),
  stage: z.array(z.string().trim().min(1)).min(1, "需要至少一个 --stage <stageId|stageName>"),
  expectedVersion: z.coerce.number().int().min(0).optional(),
});

const appearanceInput = z.object({
  game: z.string(),
  actor: z.array(z.string().trim().min(1)).min(1, "需要至少一个 --actor <actorName>"),
});

const gameOnly = z.object({ game: z.string() });

const worldInput = z.object({
  game: z.string(),
  expectedVersion: z.coerce.number().int().min(0).optional(),
});

export function registerTurnCommands(program: Command): void {
  addApiCommand(program, {
    name: "npc",
    group: GROUP,
    summary: "逐个推进 NPC 回合：一个 actor 一个作业，等完再推下一个",
    options: [
      gameOption(),
      requiredOption("--actor <names...>", "actor 名称，可重复用或一次给多个"),
      optionalOption(
        "--expected-version <n>",
        "你读到的那份视图的版本；执行开始时比对，不一致即失败",
      ),
    ],
    schema: npcInput,
    run: async (input, client) => {
      const jobs: TurnJob[] = [];
      for (const actor of input.actor) {
        jobs.push(
          await runTurnJob(client, input.game, "/turns/npc", {
            actor,
            ...(input.expectedVersion === undefined
              ? {}
              : { expectedVersion: input.expectedVersion }),
          }),
        );
      }
      return { jobs };
    },
  });

  addApiCommand(program, {
    name: "pass",
    group: GROUP,
    summary: "记空回合：这一轮跳过，顺位计数照加",
    options: [
      gameOption(),
      requiredOption("--actor <names...>", "actor 名称，可重复用或一次给多个"),
    ],
    schema: passInput,
    run: async (input, client) =>
      (await client.call({
        method: "POST",
        path: `/games/${encodeURIComponent(input.game)}/turns/pass`,
        body: { actors: input.actor },
      })) as Record<string, unknown>,
  });

  addApiCommand(program, {
    name: "stage",
    group: GROUP,
    summary: "逐个推进舞台回合：一个舞台一个作业，等完再推下一个",
    options: [
      gameOption(),
      requiredOption("--stage <refs...>", "stageId 或 stageName，可重复用或一次给多个"),
      optionalOption("--expected-version <n>", "执行开始时比对；不一致即失败"),
    ],
    schema: stageInput,
    run: async (input, client) => {
      const jobs: TurnJob[] = [];
      for (const stage of input.stage) {
        jobs.push(
          await runTurnJob(client, input.game, "/turns/stage", {
            stage,
            ...(input.expectedVersion === undefined
              ? {}
              : { expectedVersion: input.expectedVersion }),
          }),
        );
      }
      return { jobs };
    },
  });

  addApiCommand(program, {
    name: "world",
    group: GROUP,
    summary: "推进 world 回合（读取 stage 通知并裁决）",
    options: [gameOption(), optionalOption("--expected-version <n>", "执行开始时比对")],
    schema: worldInput,
    run: async (input, client) => ({
      job: await runTurnJob(client, input.game, "/turns/world", {
        ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
      }),
    }),
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
