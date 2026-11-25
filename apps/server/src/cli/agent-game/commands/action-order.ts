/**
 * 行动顺位：开一条 / 读当前 / 完成 / 移除。
 *
 * 四个命令都只动这条顺位，不推进回合——推进仍归 `npc`。排序由服务端算，命令行不传
 * 顺序也不传敏捷：`action-order-create` 只回答「现在开一条」。
 */

import type { Command } from "commander";
import { z } from "zod";
import {
  completeActionOrderOp,
  createActionOrderOp,
  readActionOrderOp,
  removeActionOrderOp,
} from "../../../game-ops";
import { gameOption, gameRef, optionalOption, requiredOption } from "../../args";
import { addCommand } from "../command";
import type { CommandContext } from "../context";

const GROUP = "行动顺位";

const gameInput = z.object({ game: gameRef });

const showInput = z.object({
  game: gameRef,
  order: z.string().trim().min(1).optional(),
});

const orderInput = z.object({
  game: gameRef,
  order: z.string().trim().min(1, "需要 --order <id>"),
});

export function registerActionOrderCommands(program: Command, ctx: CommandContext): void {
  addCommand(program, ctx, {
    name: "action-order-create",
    group: GROUP,
    summary: "开一条行动顺位：服务端按敏捷现值排序并落快照",
    options: [gameOption()],
    schema: gameInput,
    run: async (input, ctx) => ctx.db((db) => createActionOrderOp(db, input.game)),
  });

  addCommand(program, ctx, {
    name: "action-order-show",
    group: GROUP,
    summary: "读当前进行中的行动顺位（或指定 --order）",
    options: [gameOption(), optionalOption("--order <id>", "指定顺位 id，省略则读进行中的那张")],
    schema: showInput,
    run: async (input, ctx) => ctx.db((db) => readActionOrderOp(db, input.game, input.order)),
  });

  addCommand(program, ctx, {
    name: "action-order-complete",
    group: GROUP,
    summary: "完成一条行动顺位：打标记，之后不再记数",
    options: [gameOption(), requiredOption("--order <id>", "顺位 id")],
    schema: orderInput,
    run: async (input, ctx) => ctx.db((db) => completeActionOrderOp(db, input.game, input.order)),
  });

  addCommand(program, ctx, {
    name: "action-order-remove",
    group: GROUP,
    summary: "移除一条行动顺位：删行，条目级联",
    options: [gameOption(), requiredOption("--order <id>", "顺位 id")],
    schema: orderInput,
    run: async (input, ctx) => ctx.db((db) => removeActionOrderOp(db, input.game, input.order)),
  });
}
