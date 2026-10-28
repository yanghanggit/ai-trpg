/** 入队入口：校验 payload、解析重试次数，然后写入持久队列。 */

import { JobPayloadError } from "./errors";
import { toJsonValue } from "./json";
import type { JobStore } from "./store";
import type { EnqueueJobOptions, JobDefinition, JobSnapshot } from "./types";

export async function enqueueJob<Payload, Result>(
  store: Pick<JobStore, "enqueue">,
  definition: JobDefinition<Payload, Result>,
  payload: Payload,
  options: EnqueueJobOptions = {},
): Promise<JobSnapshot> {
  const parsed = definition.payload.safeParse(payload);
  if (!parsed.success) {
    throw new JobPayloadError(definition.name, parsed.error.issues);
  }

  const maxAttempts = options.maxAttempts ?? definition.maxAttempts ?? 1;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("maxAttempts 必须为正整数");
  }

  return store.enqueue({
    kind: definition.name,
    payload: toJsonValue(parsed.data, `${definition.name}.payload`),
    queue: options.queue?.trim() || "default",
    serializationKey: options.serializationKey?.trim() || null,
    maxAttempts,
    runAt: options.runAt ?? new Date(),
  });
}
