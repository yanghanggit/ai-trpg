/**
 * 作业注册表：把稳定的 job kind 映射到 handler 与 payload schema。
 *
 * 显式注册，不做按目录自动发现；worker 只执行注册过的作业，
 * 未注册的 kind 会被标记 failed，避免队列里出现「看起来成功但没人处理」的作业。
 */

import { JobDefinitionError } from "./errors";
import type { JobDefinition } from "./types";

const JOB_KIND = /^[a-z][a-z0-9_.-]*$/;

export class JobRegistry {
  private readonly definitions = new Map<string, JobDefinition<unknown, unknown>>();

  register<Payload, Result>(definition: JobDefinition<Payload, Result>): this {
    validateJobDefinition(definition);
    if (this.definitions.has(definition.name)) {
      throw new JobDefinitionError(`作业重复注册: ${definition.name}`);
    }
    this.definitions.set(definition.name, definition as unknown as JobDefinition<unknown, unknown>);
    return this;
  }

  get(name: string): JobDefinition<unknown, unknown> | undefined {
    return this.definitions.get(name);
  }

  require(name: string): JobDefinition<unknown, unknown> {
    const definition = this.get(name);
    if (!definition) {
      throw new JobDefinitionError(`作业未注册: ${name}`);
    }
    return definition;
  }

  names(): string[] {
    return [...this.definitions.keys()].sort();
  }

  get size(): number {
    return this.definitions.size;
  }
}

export function defineJob<Payload, Result = unknown>(
  definition: JobDefinition<Payload, Result>,
): JobDefinition<Payload, Result> {
  validateJobDefinition(definition);
  return definition;
}

function validateJobDefinition(definition: {
  name: string;
  run: unknown;
  maxAttempts?: number;
  timeoutMs?: number;
}): void {
  if (!JOB_KIND.test(definition.name)) {
    throw new JobDefinitionError(`作业名必须是小写、以字母开头的稳定标识: ${definition.name}`);
  }
  if (typeof definition.run !== "function") {
    throw new JobDefinitionError(`作业缺少 handler: ${definition.name}`);
  }
  if (definition.maxAttempts !== undefined) {
    if (!Number.isInteger(definition.maxAttempts) || definition.maxAttempts < 1) {
      throw new JobDefinitionError(`作业 maxAttempts 必须是正整数: ${definition.name}`);
    }
  }
  if (definition.timeoutMs !== undefined) {
    if (!Number.isFinite(definition.timeoutMs) || definition.timeoutMs <= 0) {
      throw new JobDefinitionError(`作业 timeoutMs 必须是正数: ${definition.name}`);
    }
  }
}
