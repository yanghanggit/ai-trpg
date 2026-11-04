/**
 * 参数原语：一份 zod schema 同时给出类型、校验与错误文案；
 * commander 的 Option 工厂只负责声明 flags 与 help 补全。
 */

import { Option } from "commander";
import { z } from "zod";

/** 引用型参数：非空且已 trim；缺失时的文案直接告诉调用方该传什么。 */
export const gameRef = z.string().trim().min(1, "需要 --game <gameId|slug>");
export const actorRef = z.string().trim().min(1, "需要 --actor <actorName>");
export const itemName = z.string().trim().min(1, "需要 --item <itemName>");

export function nonEmptyText(label: string) {
  return z.string().trim().min(1, `需要非空 ${label}`);
}

/** `--limit` 之类的正整数；coerce 之后再校验，避免 `--limit 3` 被当成字符串。 */
export function positiveIntArg(label: string) {
  return z.coerce.number().refine((value) => Number.isInteger(value) && value > 0, {
    message: `${label} 必须是正整数`,
  });
}

/** `--min-ratio` 之类的 0..1 比例。 */
export function ratioArg(label: string) {
  return z.coerce.number().refine((value) => value >= 0 && value <= 1, {
    message: `${label} 必须在 0 与 1 之间`,
  });
}

/** 逗号 / 中文逗号 / 空白分隔的名字清单。 */
export function splitNames(raw: string | undefined): string[] {
  if (raw === undefined) {
    return [];
  }
  return raw
    .split(/[,，\s]+/)
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

export function requiredOption(flags: string, description: string): Option {
  return new Option(flags, description).makeOptionMandatory();
}

export function optionalOption(flags: string, description: string): Option {
  return new Option(flags, description);
}

export function choiceOption(
  flags: string,
  description: string,
  values: readonly string[],
): Option {
  return new Option(flags, description).choices([...values]);
}

/** 命令组共用的 `--game`，避免每个命令各写一份 flags 与说明。 */
export function gameOption(): Option {
  return requiredOption("--game <ref>", "gameId 或 slug");
}

export function actorOption(): Option {
  return requiredOption("--actor <name>", "actor 名称");
}

/**
 * 与别的参数二选一的 `--actor`（`npc --all`、`probe --stage`、`memory --owner`）。
 *
 * 必填性交给 zod 的 refine：commander 先报「required option」会把组合规则说丢。
 */
export function optionalActorOption(): Option {
  return optionalOption("--actor <name>", "actor 名称");
}
