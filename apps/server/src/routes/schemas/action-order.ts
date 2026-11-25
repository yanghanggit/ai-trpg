/**
 * 行动顺位的线上契约：`ActionOrderState` 的逐个字段。
 *
 * 形状的源在引擎（`kernel/types`），这里只负责序列化与文档；`satisfies` 让引擎加字段
 * 或改可空性时这里编译不过，而不是等客户端拿到一个它不认识的 JSON。
 */

import type { z } from "zod";
import { z as zod } from "zod";
import type {
  ActionOrderEntryState,
  ActionOrderNextActorState,
  ActionOrderState,
} from "../../game/kernel/types";

/** 谁执行：引擎跑循环，还是客户端直接提交一个已决定好的动作。 */
const controlSchema = zod.enum(["agent", "player"]);

const actionOrderEntrySchema = zod
  .object({
    actorId: zod.string(),
    actorName: zod.string(),
    position: zod.number(),
    agility: zod.number(),
    turnsTaken: zod.number(),
    control: controlSchema,
    alive: zod.boolean(),
  })
  .meta({ id: "ActionOrderEntry" }) satisfies z.ZodType<ActionOrderEntryState>;

const actionOrderNextActorSchema = zod
  .object({
    position: zod.number(),
    actorId: zod.string(),
    actorName: zod.string(),
    control: controlSchema,
  })
  .meta({ id: "ActionOrderNextActor" }) satisfies z.ZodType<ActionOrderNextActorState>;

export const actionOrderSchema = zod
  .object({
    id: zod.string(),
    status: zod.enum(["active", "completed"]),
    createdAt: zod.string(),
    completedAt: zod.string().nullable(),
    entries: zod.array(actionOrderEntrySchema),
    gameVersion: zod.number(),
    nextActor: actionOrderNextActorSchema.nullable(),
  })
  .meta({ id: "ActionOrder" }) satisfies z.ZodType<ActionOrderState>;
