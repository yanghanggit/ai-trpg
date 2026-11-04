/**
 * 命令描述符：一个子命令 = 一段 help 文案 + 一份 zod schema + 一个执行函数。
 *
 * 新增命令只加一个描述符；校验、错误归属与输出信封都在这里统一处理。
 */

import type { Command, Option } from "commander";
import type { z } from "zod";
import type { CommandContext } from "./context";
import { describeFailure } from "./errors";
import { emit, emitText } from "./io";

export type CommandDefinition<T extends z.ZodType> = {
  /** 子命令名，例如 `player-say`。 */
  name: string;
  /** `--help` 里的一行说明。 */
  summary: string;
  /** `--help` 的分组标题；trace 之类嵌套命令不需要。 */
  group?: string;
  /** 覆盖输出里的 `action`；trace 子命令统一记成 `trace`，靠 `sub` 区分。 */
  action?: string;
  options?: readonly Option[];
  /** 参数形状与校验；错误文案直接出现在 CLI 输出里。 */
  schema: T;
  /** 执行体：只读入参、只写返回值；失败用 throw 表达。 */
  run: (input: z.infer<T>, ctx: CommandContext) => Promise<Record<string, unknown>>;
  /** 人类模式：跳过 JSON 信封，直接输出这段文本。 */
  render?: (output: Record<string, unknown>) => string;
};

export function addCommand<T extends z.ZodType>(
  parent: Command,
  ctx: CommandContext,
  def: CommandDefinition<T>,
): Command {
  const action = def.action ?? def.name;
  const command = parent.command(def.name).description(def.summary);
  if (def.group !== undefined) {
    command.helpGroup(def.group);
  }
  for (const option of def.options ?? []) {
    command.addOption(option);
  }
  command.action(async (options: Record<string, unknown>) => {
    try {
      const input = def.schema.parse(options) as z.infer<T>;
      const output = await def.run(input, ctx);
      if (def.render !== undefined) {
        emitText(def.render(output));
        return;
      }
      emit({ ok: true, action, ...output });
    } catch (error) {
      throw describeFailure(error, action);
    }
  });
  return command;
}
