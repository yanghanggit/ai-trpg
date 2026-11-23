/**
 * agent-api 的命令描述符：与 `agent-game` 同形状，只是执行体换成一次 HTTP 调用。
 */

import type { Command, Option } from "commander";
import type { z } from "zod";
import { CliFailure, describeFailure } from "../errors";
import { emit, emitText } from "../io";
import { type ApiClient, ApiFailure, createApiClient, type GlobalFlags } from "./client";

export type ApiCommandDefinition<T extends z.ZodType> = {
  /** 子命令名，与 `agent-game` 的同名命令对应。 */
  name: string;
  summary: string;
  /** `--help` 的分组标题；trace 之类嵌套命令不需要。 */
  group?: string;
  /** 覆盖输出里的 `action`；trace 子命令统一记成 `trace`。 */
  action?: string;
  options?: readonly Option[];
  schema: T;
  run: (input: z.infer<T>, client: ApiClient) => Promise<Record<string, unknown>>;
  /** 人类模式：跳过 JSON 信封。 */
  render?: (output: Record<string, unknown>) => string;
};

export function addApiCommand<T extends z.ZodType>(
  parent: Command,
  def: ApiCommandDefinition<T>,
): Command {
  const action = def.action ?? def.name;
  const command = parent.command(def.name).description(def.summary);
  if (def.group !== undefined) {
    command.helpGroup(def.group);
  }
  for (const option of def.options ?? []) {
    command.addOption(option);
  }
  command.action(async (options: Record<string, unknown>, cmd: Command) => {
    try {
      const input = def.schema.parse(options) as z.infer<T>;
      const client = createApiClient(cmd.optsWithGlobals<GlobalFlags>());
      const output = await def.run(input, client);
      if (def.render !== undefined) {
        emitText(def.render(output));
        return;
      }
      emit({ ok: true, action, ...output });
    } catch (error) {
      if (error instanceof ApiFailure) {
        throw new CliFailure(error.message, action, 1, {
          ...(error.status === 0 ? {} : { status: error.status }),
          code: error.code,
          ...(error.details === undefined ? {} : { details: error.details }),
        });
      }
      throw describeFailure(error, action);
    }
  });
  return command;
}
