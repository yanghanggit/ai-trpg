/**
 * 排查与维护：探针、记忆、名字审计、压缩。
 *
 * `memory` 在服务端只取原文，导出 Markdown 由本进程完成——文件属于调用方。
 */

import type { Command } from "commander";
import { z } from "zod";
import type { MemoryDumpGame } from "../../../debug/memory-dump";
import { dumpMemory } from "../../../debug/memory-dump";
import { renderNameLeakReport } from "../../../game";
import type { AgentMemoryState } from "../../../game/memory";
import type { NameLeakReport } from "../../../game/name-audit";
import {
  gameOption,
  nonEmptyText,
  optionalActorOption,
  optionalOption,
  ratioArg,
  requiredOption,
  splitNames,
} from "../../args";
import { UsageError } from "../../errors";
import { addApiCommand } from "../command";

const GROUP = "排查与维护";

const probeInput = z
  .object({
    game: z.string(),
    actor: z.string().trim().min(1).optional(),
    stage: z.string().trim().min(1).optional(),
    message: nonEmptyText("--message"),
  })
  .refine((input) => (input.actor === undefined) !== (input.stage === undefined), {
    message: "probe 需要 --actor 或 --stage 二选一",
  });

const memoryInput = z
  .object({
    game: z.string(),
    actor: z.string().trim().min(1).optional(),
    stage: z.string().trim().min(1).optional(),
    owner: z.enum(["actor", "stage", "world"]).optional(),
    name: z.string().trim().min(1).optional(),
    out: z.string().trim().min(1).optional(),
  })
  .refine(
    (input) =>
      [input.actor, input.stage, input.owner].filter((value) => value !== undefined).length === 1,
    { message: "memory 需要 --actor、--stage 或 --owner <actor|stage|world> 三者之一" },
  )
  .refine(
    (input) => input.owner === undefined || input.owner === "world" || input.name !== undefined,
    { message: "memory --owner actor / --owner stage 还需要 --name" },
  );

const nameLeaksInput = z.object({
  game: z.string(),
  scope: z.enum(["ever", "current"]).default("ever"),
  allow: z.string().optional(),
  includeSystem: z.boolean().default(false),
  since: z.string().trim().min(1).optional(),
  text: z.boolean().default(false),
});

const compactInput = z
  .object({
    game: z.string(),
    owner: z.enum(["actor", "stage", "world", "all"]),
    name: z.string().trim().min(1).optional(),
    minRatio: ratioArg("--min-ratio").optional(),
  })
  .refine(
    (input) => (input.owner !== "actor" && input.owner !== "stage") || input.name !== undefined,
    { message: "compact --owner actor / --owner stage 需要 --name" },
  );

export function registerInspectCommands(program: Command): void {
  addApiCommand(program, {
    name: "probe",
    group: GROUP,
    summary: "只读探针：让 agent 只凭 prompt 与 memory 回答一个问题",
    options: [
      gameOption(),
      optionalActorOption(),
      optionalOption("--stage <ref>", "以舞台 agent 为探针目标"),
      requiredOption("--message <text>", "问题"),
    ],
    schema: probeInput,
    run: async (input, client) =>
      (await client.call({
        method: "POST",
        path: `/games/${encodeURIComponent(input.game)}/probe`,
        body: { actor: input.actor, stage: input.stage, message: input.message },
      })) as Record<string, unknown>,
  });

  addApiCommand(program, {
    name: "memory",
    group: GROUP,
    summary: "把某个 agent 的 memory 原样导出成 Markdown",
    options: [
      gameOption(),
      optionalActorOption(),
      optionalOption("--stage <ref>", "按舞台取 memory"),
      optionalOption("--owner <owner>", "记忆所有者：actor / stage / world"),
      optionalOption("--name <ref>", "配合 --owner actor/stage 使用"),
      optionalOption("--out <path>", "输出目录或 .md 路径"),
    ],
    schema: memoryInput,
    run: async (input, client) => {
      const ownerType = input.actor !== undefined ? "actor" : (input.owner ?? "stage");
      const name = input.actor ?? input.stage ?? input.name;
      if (ownerType !== "world" && name === undefined) {
        throw new UsageError("actor / stage 还需要 --name");
      }
      const result = (await client.call({
        method: "GET",
        path: `/games/${encodeURIComponent(input.game)}/memory`,
        query: { owner: ownerType, name },
      })) as {
        owner: unknown;
        game: MemoryDumpGame;
        memory: AgentMemoryState;
        messages: number;
      };
      const path = await dumpMemory(
        { game: result.game, memory: result.memory },
        input.out === undefined ? {} : { out: input.out },
      );
      return { owner: result.owner, path, messages: result.messages };
    },
  });

  addApiCommand(program, {
    name: "name-leaks",
    group: GROUP,
    summary: "只读扫描 actor 记忆里的真名泄漏",
    options: [
      gameOption(),
      optionalOption("--scope <scope>", "ever（默认）或 current"),
      optionalOption("--allow <names>", "允许出现的名字，逗号分隔"),
      optionalOption("--include-system", "连 system 类消息一起扫"),
      optionalOption("--since <time>", "只看这个时间点之后的记录"),
      optionalOption("--text", "输出人类可读的报告而不是 JSON"),
    ],
    schema: nameLeaksInput,
    run: async (input, client) => {
      const since = input.since === undefined ? undefined : new Date(input.since);
      if (since !== undefined && Number.isNaN(since.getTime())) {
        throw new UsageError("--since 需要合法的日期或时间");
      }
      const allow = splitNames(input.allow);
      return (await client.call({
        method: "GET",
        path: `/games/${encodeURIComponent(input.game)}/name-leaks`,
        query: {
          scope: input.scope,
          allow: allow.length > 0 ? allow.join(",") : undefined,
          includeSystem: input.includeSystem ? "true" : undefined,
          since: since?.toISOString(),
        },
      })) as Record<string, unknown>;
    },
    // 与 `agent:game name-leaks` 一致：这份报告是给人读的。
    render: (output) => renderNameLeakReport(output.report as NameLeakReport),
  });

  addApiCommand(program, {
    name: "compact",
    group: GROUP,
    summary: "压缩某个 / 全部 agent 的 memory",
    options: [
      gameOption(),
      optionalOption("--owner <owner>", "actor / stage / world / all"),
      optionalOption("--name <ref>", "配合 --owner actor/stage 使用"),
      optionalOption("--min-ratio <ratio>", "触发压缩的上下文占用比（0..1）"),
    ],
    schema: compactInput,
    run: async (input, client) =>
      (await client.call({
        method: "POST",
        path: `/games/${encodeURIComponent(input.game)}/compact`,
        body: { owner: input.owner, name: input.name, minRatio: input.minRatio },
      })) as Record<string, unknown>,
  });
}
