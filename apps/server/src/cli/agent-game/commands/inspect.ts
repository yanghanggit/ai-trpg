/**
 * 排查与维护：`probe` / `memory` / `name-leaks` / `compact`。
 *
 * 前三个是只读旁路（不调 LLM 或不改状态），`compact` 是唯一会改记忆的维护命令。
 */

import type { Command } from "commander";
import { z } from "zod";
import { dumpMemory } from "../../../debug/memory-dump";
import { DEEPSEEK_SERVICE } from "../../../deepseek";
import {
  auditGameNameLeaks,
  type CompactMemoryResult,
  compactAllMemories,
  compactMemory,
  getGameState,
  getMemoryState,
  MEMORY_OWNER_TYPES,
  renderNameLeakReport,
  resolveMemoryOwner,
  runProbe,
} from "../../../game";
import type { ProbeTarget } from "../../../game/agents/probe";
import type { NameLeakReport } from "../../../game/name-audit";
import {
  gameOption,
  gameRef,
  nonEmptyText,
  optionalActorOption,
  optionalOption,
  ratioArg,
  requiredOption,
  splitNames,
} from "../args";
import { addCommand } from "../command";
import type { CommandContext } from "../context";
import { UsageError } from "../errors";

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
    {
      message: "memory --owner actor / --owner stage 还需要 --name",
    },
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
    {
      message: "compact --owner actor / --owner stage 需要 --name",
    },
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

export function registerInspectCommands(program: Command, ctx: CommandContext): void {
  addCommand(program, ctx, {
    name: "probe",
    group: GROUP,
    summary: "只读探针：让 agent 只凭 prompt 与 memory 回答一个问题",
    options: [
      gameOption(),
      optionalActorOption(),
      optionalOption("--stage <ref>", "以场景 agent 为探针目标"),
      requiredOption("--message <text>", "问题"),
    ],
    schema: probeInput,
    run: async (input, ctx) =>
      ctx.db((db) =>
        runProbe(db, input.game, {
          service: DEEPSEEK_SERVICE,
          message: input.message,
          target: probeTarget(input),
        }),
      ),
  });

  addCommand(program, ctx, {
    name: "memory",
    group: GROUP,
    summary: "把某个 agent 的 memory 原样导出成 Markdown",
    options: [
      gameOption(),
      optionalActorOption(),
      optionalOption("--stage <ref>", "按场景取 memory"),
      optionalOption("--owner <owner>", `记忆所有者：${MEMORY_OWNER_TYPES.join(" / ")}`),
      optionalOption("--name <ref>", "配合 --owner actor/stage 使用"),
      optionalOption("--out <path>", "输出目录或 .md 路径"),
    ],
    schema: memoryInput,
    run: async (input, ctx) =>
      ctx.db(async (db) => {
        const ownerType = input.actor !== undefined ? "actor" : (input.owner ?? "stage");
        const ownerRef = input.actor ?? input.stage ?? input.name;
        const state = await getGameState(db, input.game);
        const owner = resolveMemoryOwner(state, ownerType, ownerRef);
        const memory = await getMemoryState(db, state.game.id, owner.ownerType, owner.ownerId);
        if (!memory) {
          throw new Error(`缺少 memory: ${owner.ownerType} ${owner.name}`);
        }
        const path = await dumpMemory(
          { game: state.game, memory },
          input.out === undefined ? {} : { out: input.out },
        );
        return { owner, path, messages: memory.messages.length };
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
      const allowNames = splitNames(input.allow);
      const report = await ctx.db((db) =>
        auditGameNameLeaks(db, input.game, {
          nameScope: input.scope === "ever" ? "ever" : "currentSignature",
          ...(input.includeSystem ? { skipKinds: [] } : {}),
          ...(allowNames.length > 0 ? { allowNames } : {}),
          ...(since === undefined ? {} : { since }),
        }),
      );
      return { report };
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
    run: async (input, ctx) => {
      const options = {
        service: DEEPSEEK_SERVICE,
        ...(input.minRatio === undefined ? {} : { minRatio: input.minRatio }),
      };
      const results = await ctx.db<CompactMemoryResult[]>(async (db) => {
        if (input.owner === "all") {
          return compactAllMemories(db, input.game, options);
        }
        if (input.owner === "world") {
          return [await compactMemory(db, input.game, { ownerType: "world" }, options)];
        }
        if (input.name === undefined) {
          // refine 已经挡过一次；这里只是把类型窄化到 string。
          throw new UsageError("compact --owner actor / --owner stage 需要 --name");
        }
        const ownerType = input.owner === "actor" ? "actor" : "stage";
        return [await compactMemory(db, input.game, { ownerType, ref: input.name }, options)];
      });
      return { results };
    },
  });
}
