/**
 * 玩家动作的请求形状：一个 `kind` + 该动作自己的参数。
 *
 * 与 `agent-game` 的子命令一一对应（`say` ↔ `player-say`，`ask-route` ↔ `ask-route`），
 * 所以路由 schema、HTTP 客户端与落账分派共用这一份定义，不各写一套。
 */

import { z } from "zod";
import { EQUIPMENT_SLOTS } from "../game/kernel/types";

const text = (label: string) => z.string().trim().min(1, `需要 ${label}`);
const reason = z.string().trim().min(1).optional();

const talk = (kind: "say" | "whisper" | "call") =>
  z.object({ kind: z.literal(kind), target: text("target"), message: text("message"), reason });

export const playerActionSchema = z.discriminatedUnion("kind", [
  talk("say"),
  talk("whisper"),
  talk("call"),
  z.object({ kind: z.literal("announce"), message: text("message"), reason }),
  z.object({ kind: z.literal("move"), to: text("to") }),
  z.object({ kind: z.literal("teleport"), to: text("to") }),
  z.object({ kind: z.literal("wait") }),
  z.object({ kind: z.literal("hide") }),
  z.object({ kind: z.literal("reveal") }),
  z.object({ kind: z.literal("strike"), target: text("target") }),
  z.object({ kind: z.literal("brawl"), target: text("target") }),
  z.object({ kind: z.literal("inspect"), target: text("target") }),
  z.object({ kind: z.literal("steal"), target: text("target"), item: text("item") }),
  z.object({ kind: z.literal("give"), target: text("target"), item: text("item") }),
  z.object({
    kind: z.literal("loot"),
    target: text("target"),
    items: z.array(text("item")).optional(),
  }),
  z.object({ kind: z.literal("pickup"), anchor: text("anchor"), item: text("item") }),
  z.object({
    kind: z.literal("use"),
    item: text("item"),
    target: z.string().trim().min(1).optional(),
    stage: z.string().trim().min(1).optional(),
    anchor: z.string().trim().min(1).optional(),
  }),
  z.object({ kind: z.literal("fit"), item: text("item"), anchor: text("anchor") }),
  z.object({ kind: z.literal("equip"), item: text("item"), slot: z.enum(EQUIPMENT_SLOTS) }),
  z.object({ kind: z.literal("unequip"), slot: z.enum(EQUIPMENT_SLOTS) }),
  z.object({
    kind: z.literal("recognize-identity"),
    target: text("target"),
    name: text("name"),
  }),
  z.object({
    kind: z.literal("ask-route"),
    from: z.string().trim().min(1).optional(),
    to: text("to"),
  }),
]);

export type PlayerActionRequest = z.infer<typeof playerActionSchema>;

/**
 * 组合规则（与 CLI 的 zod refine 对齐）：`use` 的 `target` / `stage` 二选一，
 * `anchor` 只能跟 `stage` 一起给。
 */
export const playerActionBodySchema = playerActionSchema.superRefine((action, ctx) => {
  if (action.kind !== "use") {
    return;
  }
  if ((action.target === undefined) === (action.stage === undefined)) {
    ctx.addIssue({ code: "custom", message: "use 需要 target 或 stage 二选一" });
  }
  if (action.anchor !== undefined && action.stage === undefined) {
    ctx.addIssue({ code: "custom", message: "use 的 anchor 只能与 stage 一起使用" });
  }
});
