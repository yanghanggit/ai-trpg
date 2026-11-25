/**
 * 回合作业的线上契约：`TurnJobView` 的逐个字段。
 *
 * 形状的源在 `game-ops/turn-jobs` 与 `jobs/types`，这里只负责序列化与文档；
 * `satisfies` 让引擎加字段或改可空性时这里编译不过，而不是等客户端拿到一个它不认识的 JSON。
 */

import { z } from "zod";
import type { TurnJobResult, TurnJobView } from "../../game-ops/turn-jobs";
import { JOB_STATUSES } from "../../jobs/types";

const turnJobResultSchema = z
  .object({
    ok: z.boolean(),
    messageCursor: z.number().optional(),
    actions: z.array(z.string()).optional(),
  })
  .meta({ id: "TurnJobResult" }) satisfies z.ZodType<TurnJobResult>;

/** 一条作业：状态、失败原因与结果摘要；payload 与租约字段不外露。 */
export const turnJobSchema = z
  .object({
    jobId: z.string(),
    kind: z.string(),
    queue: z.string(),
    status: z.enum(JOB_STATUSES),
    serializationKey: z.string().nullable(),
    attempts: z.number(),
    maxAttempts: z.number(),
    error: z.string().nullable(),
    errorCode: z.string().nullable(),
    runAt: z.string(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    result: turnJobResultSchema.nullable(),
  })
  .meta({ id: "TurnJob" }) satisfies z.ZodType<TurnJobView>;
