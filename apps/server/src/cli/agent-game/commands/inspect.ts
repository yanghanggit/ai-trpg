/**
 * 排查与维护：`probe` / `memory` / `name-leaks` / `compact`。
 *
 * 参数与帮助在这里，探针、记忆与压缩的编排在 `game-ops`；记忆导出的文件写入
 * 留给本进程——写文件属于调用方，不属于服务端。
 */

import type { Command } from "commander";
import { z } from "zod";
import { dumpMemory } from "../../../debug/memory-dump";
import { DEEPSEEK_SERVICE } from "../../../deepseek";
import { renderNameLeakReport } from "../../../game";
import type { ProbeTarget } from "../../../game/agents/probe";
import type { NameLeakReport } from "../../../game/name-audit";
import {
  type CompactQuery,
  compactOp,
  MEMORY_OWNER_TYPES,
  type MemoryQuery,
  memoryOp,
  nameLeaksOp,
  probeOp,
} from "../../../game-ops";
import {
  gameOption,
  gameRef,
  nonEmptyText,
  optionalActorOption,
  optionalOption,
  ratioArg,
  requiredOption,
  splitNames,
} from "../../args";
import { UsageError } from "../../errors";
import { addCommand } from "../command";
import type { CommandContext } from "../context";

const GROUP = "排查与维护";

const probeInput = z
  .object({
    game: gameRef,
    actor: z.string().trim().min(1).optional(),
    stage: z.string().trim().min(1).optional(),
    message: nonEmptyText("--message"),
  })
  .refine((input) => (input.actor === undefined) !== (input.stage === undefined), {
    message: "probe 需要 --actor 或 --stage 二选一",
  });

const memoryInput = z
  .object({
    game: gameRef,
    actor: z.string().trim().min(1).optional(),
    stage: z.string().trim().min(1).optional(),
    owner: z.enum(MEMORY_OWNER_TYPES).optional(),
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
  game: gameRef,
  scope: z.enum(["ever", "current"]).default("ever"),
  allow: z.string().optional(),
  includeSystem: z.boolean().default(false),
  since: z.string().trim().min(1).optional(),
  text: z.boolean().default(false),
});

const compactInput = z
  .object({
    game: gameRef,
    owner: z.enum(["actor", "stage", "world", "all"]),
    name: z.string().trim().min(1).optional(),
    minRatio: ratioArg("--min-ratio").optional(),
  })
  .refine(
    (input) => (input.owner !== "actor" && input.owner !== "stage") || input.name !== undefined,
    { message: "compact --owner actor / --owner stage 需要 --name" },
  );

/** `--actor` 与 `--stage` 二选一：refine 已挡过一次，这里只把类型窄化到 `ProbeTarget`。 */
function probeTarget(input: { actor?: string; stage?: string }): ProbeTarget {
  if (input.actor !== undefined) {
    return { type: "actor", actorRef: input.actor };
  }
  if (input.stage !== undefined) {
    return { type: "stage", stageRef: input.stage };
  }
  throw new UsageError("probe 需要 --actor 或 --stage 二选一");
}

/** 三个别名（`--actor` / `--stage` / `--owner`）归一成 owner + 名字。 */
function memoryQuery(input: {
  actor?: string;
  stage?: string;
  owner?: "actor" | "stage" | "world";
  name?: string;
}): MemoryQuery {
  const ownerType = input.actor !== undefined ? "actor" : (input.owner ?? "stage");
  if (ownerType === "world") {
    return { owner: "world" };
  }
  const name = input.actor ?? input.stage ?? input.name;
  if (name === undefined) {
    throw new UsageError("actor / stage 还需要 --name");
  }
  return { owner: ownerType, name };
}

function compactQuery(input: {
  owner: "actor" | "stage" | "world" | "all";
  name?: string;
  minRatio?: number;
}): CompactQuery {
  const minRatio = input.minRatio === undefined ? {} : { minRatio: input.minRatio };
  if (input.owner === "all") {
    return { owner: "all", ...minRatio };
  }
  if (input.owner === "world") {
    return { owner: "world", ...minRatio };
  }
  if (input.name === undefined) {
    throw new UsageError("compact --owner actor / --owner stage 需要 --name");
  }
  return { owner: input.owner, name: input.name, ...minRatio };
}

export function registerInspectCommands(program: Command, ctx: CommandContext): void {
  addCommand(program, ctx, {
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
    run: async (input, ctx) =>
      ctx.db((db) =>
        probeOp(
          db,
          input.game,
          { message: input.message, target: probeTarget(input) },
          { service: DEEPSEEK_SERVICE },
        ),
      ),
  });

  addCommand(program, ctx, {
    name: "memory",
    group: GROUP,
    summary: "把某个 agent 的 memory 原样导出成 Markdown",
    options: [
      gameOption(),
      optionalActorOption(),
      optionalOption("--stage <ref>", "按舞台取 memory"),
      optionalOption("--owner <owner>", `记忆所有者：${MEMORY_OWNER_TYPES.join(" / ")}`),
      optionalOption("--name <ref>", "配合 --owner actor/stage 使用"),
      optionalOption("--out <path>", "输出目录或 .md 路径"),
    ],
    schema: memoryInput,
    run: async (input, ctx) =>
      ctx.db(async (db) => {
        const result = await memoryOp(db, input.game, memoryQuery(input));
        const path = await dumpMemory(
          { game: result.game, memory: result.memory },
          input.out === undefined ? {} : { out: input.out },
        );
        return { owner: result.owner, path, messages: result.messages };
      }),
  });

  addCommand(program, ctx, {
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
    run: async (input, ctx) => {
      const since = input.since === undefined ? undefined : new Date(input.since);
      if (since !== undefined && Number.isNaN(since.getTime())) {
        throw new UsageError("--since 需要合法的日期或时间");
      }
      return ctx.db((db) =>
        nameLeaksOp(db, input.game, {
          scope: input.scope === "ever" ? "ever" : "current",
          ...(input.includeSystem ? { includeSystem: true } : {}),
          allow: splitNames(input.allow),
          ...(since === undefined ? {} : { since }),
        }),
      );
    },
    render: (output) => renderNameLeakReport(output.report as NameLeakReport),
  });

  addCommand(program, ctx, {
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
    run: async (input, ctx) =>
      ctx.db((db) => compactOp(db, input.game, compactQuery(input), { service: DEEPSEEK_SERVICE })),
  });
}
