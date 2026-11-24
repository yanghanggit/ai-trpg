/**
 * 行动顺位的线上契约：`ActionOrderState` 的逐个字段。
 *
 * 形状的源在引擎（`kernel/types`），这里只负责序列化与文档；`satisfies` 让引擎加字段
 * 或改可空性时这里编译不过，而不是等客户端拿到一个它不认识的 JSON。
 */

import type { z } from "zod";
import { z as zod } from "zod";
import type { ActionOrderEntryState, ActionOrderState } from "../../game/kernel/types";

const actionOrderEntrySchema = zod
  .object({
    actorId: zod.string(),
    actorName: zod.string(),
    position: zod.number(),
    agility: zod.number(),
    actionsTaken: zod.number(),
  })
  .meta({ id: "ActionOrderEntry" }) satisfies z.ZodType<ActionOrderEntryState>;

export const actionOrderSchema = zod
  .object({
    id: zod.string(),
    status: zod.enum(["active", "completed"]),
    createdAt: zod.string(),
    completedAt: zod.string().nullable(),
    entries: zod.array(actionOrderEntrySchema),
  })
  .meta({ id: "ActionOrder" }) satisfies z.ZodType<ActionOrderState>;
