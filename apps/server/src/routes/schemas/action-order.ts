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
  ActionOrderRoundState,
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

const roundActorSchema = z.object({
  actorId: z.string(),
  name: z.string(),
  /** 空回合：轮到过、没有动作落账。 */
  empty: z.boolean(),
});

const roundStageSchema = z.object({
  stageId: z.string(),
  name: z.string(),
  /** 这一行动轮推过几次（每个演员回合之后各一次）。 */
  turns: z.number(),
});

/**
 * 行动轮：本轮的进度读数。
 *
 * 它回答的是「集体推到哪了」——顺位回答「谁排第几、该谁了」。两者并列下发，不互相嵌套。
 */
export const actionOrderRoundSchema = z
  .object({
    /** 行动轮编号：已落账的 world 回合数 + 1。 */
    index: z.number(),
    /** 本轮已经落过账的角色（含空回合）。 */
    actors: z.array(roundActorSchema),
    /** 本轮已经推过的舞台与次数。 */
    stages: z.array(roundStageSchema),
    /** 本轮的 world 回合推过没有。 */
    world: z.boolean(),
  })
  .meta({ id: "ActionOrderRound" }) satisfies z.ZodType<ActionOrderRoundState>;

export const actionOrderSchema = z
  .object({
    id: z.string(),
    status: z.enum(["active", "completed"]),
    createdAt: z.string(),
    completedAt: z.string().nullable(),
    entries: z.array(actionOrderEntrySchema),
    /** 读出这一刻的游戏时刻；回合落账时 +1。 */
    clock: z.number(),
    gameVersion: z.number(),
    nextActor: actionOrderNextActorSchema.nullable(),
  })
  .meta({ id: "ActionOrder" }) satisfies z.ZodType<ActionOrderState>;
