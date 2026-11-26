/**
 * 作业：查看、取消、订阅。
 *
 * 这三个命令不做编排（编排在 `tick`），它们回答的是运行期的问题：
 * 现在有没有回合在跑、那一条能不能撤、正在跑的那一条到了哪一步。
 */

import type { Command } from "commander";
import { z } from "zod";
import { gameOption, optionalOption, requiredOption } from "../../args";
import { note } from "../../io";
import { addApiCommand } from "../command";
import { cancelTurnJob, listTurnJobs, watchTurnJobs } from "../jobs";

const GROUP = "作业";

const listInput = z.object({
  game: z.string(),
  status: z.enum(["active", "all"]).optional(),
  updatedSince: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const jobInput = z.object({
  game: z.string(),
  job: z.string().trim().min(1, "需要 --job <jobId>"),
});

const watchInput = z.object({
  game: z.string(),
  since: z.string().trim().min(1).optional(),
});

export function registerJobCommands(program: Command): void {
  addApiCommand(program, {
    name: "jobs",
    group: GROUP,
    summary: "列这一局的作业：默认只列排队与执行中的",
    options: [
      gameOption(),
      optionalOption("--status <active|all>", "active 只看活跃（默认），all 连历史一起列"),
      optionalOption("--updated-since <iso>", "只要更新时间晚于它的作业"),
      optionalOption("--limit <n>", "最多几条，默认服务端的 50"),
    ],
    schema: listInput,
    run: async (input, client) => ({
      game: input.game,
      jobs: await listTurnJobs(client, input.game, {
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.updatedSince === undefined ? {} : { updatedSince: input.updatedSince }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      }),
    }),
  });

  addApiCommand(program, {
    name: "job-cancel",
    group: GROUP,
    summary: "取消一个回合：排队中的当场撤，执行中的在下一个检查点停",
    options: [gameOption(), requiredOption("--job <jobId>", "作业 id")],
    schema: jobInput,
    run: async (input, client) => await cancelTurnJob(client, input.game, input.job),
  });

  addApiCommand(program, {
    name: "job-watch",
    group: GROUP,
    summary: "订阅这一局的作业状态（SSE），每行一条 JSON；Ctrl-C 结束",
    options: [
      gameOption(),
      optionalOption("--since <iso>", "从这个游标之后补发；不给就只补活跃作业"),
    ],
    schema: watchInput,
    run: async (input, client) => {
      // 每条事件一行 JSON（JSONL），最后再给一份汇总信封。
      const seen = new Set<string>();
      note(`订阅第 ${input.game} 局：每条事件一行 JSON，Ctrl-C 结束`);
      await watchTurnJobs(client, input.game, {
        ...(input.since === undefined ? {} : { since: input.since }),
        onOpen: () => note("已连接"),
        onJob: (job) => {
          seen.add(job.jobId);
          process.stdout.write(`${JSON.stringify({ ok: true, action: "job-watch", job })}\n`);
        },
      });
      return { game: input.game, jobs: seen.size };
    },
  });
}
