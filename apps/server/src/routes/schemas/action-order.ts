/**
 * 行动顺位的线上契约：`ActionOrderState` 的逐个字段。
 *
 * 形状的源在引擎（`kernel/types`），这里只负责序列化与文档；`satisfies` 让引擎加字段
 * 或改可空性时这里编译不过，而不是等客户端拿到一个它不认识的 JSON。
 */

import { z } from "zod";
import type {
  ActionOrderEntryState,
  ActionOrderNextActorState,
  ActionOrderState,
} from "../../game/kernel/types";

/** 谁执行：引擎跑循环，还是客户端直接提交一个已决定好的动作。 */
const controlSchema = z.enum(["agent", "player"]);

const actionOrderEntrySchema = z
  .object({
    actorId: z.string(),
    actorName: z.string(),
    position: z.number(),
    agility: z.number(),
    turnsTaken: z.number(),
    control: controlSchema,
    alive: z.boolean(),
  })
  .meta({ id: "ActionOrderEntry" }) satisfies z.ZodType<ActionOrderEntryState>;

const actionOrderNextActorSchema = z
  .object({
    position: z.number(),
    actorId: z.string(),
    actorName: z.string(),
    control: controlSchema,
  })
  .meta({ id: "ActionOrderNextActor" }) satisfies z.ZodType<ActionOrderNextActorState>;

export const actionOrderSchema = z
  .object({
    id: z.string(),
    status: z.enum(["active", "completed"]),
    createdAt: z.string(),
    completedAt: z.string().nullable(),
    entries: z.array(actionOrderEntrySchema),
    gameVersion: z.number(),
    nextActor: actionOrderNextActorSchema.nullable(),
  })
  .meta({ id: "ActionOrder" }) satisfies z.ZodType<ActionOrderState>;
