/**
 * 行动顺位：与 `agent-game` 同名同参数；一次请求一件事。
 *
 * 排序在服务端算，命令行不传顺序也不传敏捷。
 */

import type { Command } from "commander";
import { z } from "zod";
import { gameOption, optionalOption, requiredOption } from "../../args";
import { addApiCommand } from "../command";

const GROUP = "行动顺位";

const gameInput = z.object({ game: z.string() });

const showInput = z.object({
  game: z.string(),
  order: z.string().trim().min(1).optional(),
});

const orderInput = z.object({
  game: z.string(),
  order: z.string().trim().min(1, "需要 --order <id>"),
});

export function registerActionOrderCommands(program: Command): void {
  addApiCommand(program, {
    name: "action-order-create",
    group: GROUP,
    summary: "开一条行动顺位：服务端按敏捷现值排序并落快照",
    options: [gameOption()],
    schema: gameInput,
    run: async (input, client) =>
      (await client.call({
        method: "POST",
        path: `/games/${encodeURIComponent(input.game)}/action-orders`,
      })) as Record<string, unknown>,
  });

  addApiCommand(program, {
    name: "action-order-show",
    group: GROUP,
    summary: "读当前进行中的行动顺位（或指定 --order）",
    options: [gameOption(), optionalOption("--order <id>", "指定顺位 id，省略则读进行中的那张")],
    schema: showInput,
    run: async (input, client) =>
      (await client.call({
        method: "GET",
        path:
          input.order === undefined
            ? `/games/${encodeURIComponent(input.game)}/action-orders/current`
            : `/games/${encodeURIComponent(input.game)}/action-orders/${encodeURIComponent(input.order)}`,
      })) as Record<string, unknown>,
  });

  addApiCommand(program, {
    name: "action-order-complete",
    group: GROUP,
    summary: "完成一条行动顺位：打标记，之后不再记数",
    options: [gameOption(), requiredOption("--order <id>", "顺位 id")],
    schema: orderInput,
    run: async (input, client) =>
      (await client.call({
        method: "POST",
        path: `/games/${encodeURIComponent(input.game)}/action-orders/${encodeURIComponent(input.order)}/complete`,
      })) as Record<string, unknown>,
  });

  addApiCommand(program, {
    name: "action-order-remove",
    group: GROUP,
    summary: "移除一条行动顺位：删行，条目级联",
    options: [gameOption(), requiredOption("--order <id>", "顺位 id")],
    schema: orderInput,
    run: async (input, client) =>
      (await client.call({
        method: "DELETE",
        path: `/games/${encodeURIComponent(input.game)}/action-orders/${encodeURIComponent(input.order)}`,
      })) as Record<string, unknown>,
  });
}
