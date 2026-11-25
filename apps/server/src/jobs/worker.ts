/**
 * 持久作业 worker：领取 → 执行 → 完成 / 重试 / 失败。
 *
 * 执行期间不持有数据库事务；`locked_at` 心跳让失联 worker 的作业能被回收。
 * 这是「HTTP 不被长作业阻塞」的执行端：HTTP 层以后只负责入队与查询，不跑 handler。
 */

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { type Logger, silentLogger } from "../logging";
import { NonRetryableJobError } from "./errors";
import { toJsonValue } from "./json";
import type { JobRegistry } from "./registry";
import type { JobStore } from "./store";
import type { JobContext, JobRecord } from "./types";

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_STALE_AFTER_MS = 15 * 60 * 1_000;
const MIN_RECLAIM_INTERVAL_MS = 30_000;
const MAX_ERROR_LENGTH = 16_000;

export type JobWorkerOptions = {
  store: JobStore;
  registry: JobRegistry;
  /** 监听的队列，默认 `default`。 */
  queues?: readonly string[];
  /** 同时执行的作业数，默认 2。 */
  concurrency?: number;
  pollIntervalMs?: number;
  /** 超过该时长没有心跳就视为 worker 失联；0 关闭回收。 */
  staleAfterMs?: number;
  /** 第 attempt 次失败后的重试延迟，默认 1s、2s、4s……最多 60s。 */
  retryDelayMs?: (attempt: number) => number;
  workerId?: string;
  logger?: Logger;
};

function defaultRetryDelayMs(attempt: number): number {
  return Math.min(60_000, 1_000 * 2 ** Math.max(0, attempt - 1));
}

/**
 * 失败码：只认错误对象上的字符串 `code`，不认识具体业务类型。
 *
 * 作业层不该依赖业务层的错误类；业务错误自带 `code`（如 `invalid_state`）就够了，
 * 客户端因此可以按码决定重读、跳过还是报错，而不必解析错误文本。
 */
function errorCodeOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }
  const code = (error as { code: unknown }).code;
  return typeof code === "string" && code.length > 0 && code.length <= 64 ? code : null;
}

function errorText(error: unknown): string {
  // 业务错误（带 code）只留一句人话：栈属于轨迹，客户端要读的是「为什么这一回合没成」。
  const text =
    error instanceof Error && errorCodeOf(error) !== null
      ? `${error.name}: ${error.message}`
      : error instanceof Error
        ? (error.stack ?? `${error.name}: ${error.message}`)
        : String(error);
  return text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH)}…` : text;
}

export class JobWorker {
  readonly workerId: string;
  readonly queues: readonly string[];

  private readonly store: JobStore;
  private readonly registry: JobRegistry;
  private readonly concurrency: number;
  private readonly pollIntervalMs: number;
  private readonly staleAfterMs: number;
  private readonly retryDelayMs: (attempt: number) => number;
  private readonly logger: Logger;
  private readonly reclaimIntervalMs: number;
  private readonly stopController = new AbortController();
  private readonly controllers = new Set<AbortController>();
  private readonly runningJobs = new Set<Promise<void>>();
  private stopping = false;
  private started = false;

  constructor(options: JobWorkerOptions) {
    this.store = options.store;
    this.registry = options.registry;
    this.queues =
      options.queues && options.queues.length > 0 ? [...new Set(options.queues)] : ["default"];
    this.concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.retryDelayMs = options.retryDelayMs ?? defaultRetryDelayMs;
    this.workerId = options.workerId ?? `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
    this.logger = options.logger ?? silentLogger;
    this.reclaimIntervalMs = Math.max(MIN_RECLAIM_INTERVAL_MS, this.staleAfterMs / 2);

    if (!Number.isInteger(this.concurrency) || this.concurrency < 1) {
      throw new RangeError("concurrency 必须为 >= 1 的整数");
    }
    if (!Number.isFinite(this.pollIntervalMs) || this.pollIntervalMs <= 0) {
      throw new RangeError("pollIntervalMs 必须为正数");
    }
    if (!Number.isFinite(this.staleAfterMs) || this.staleAfterMs < 0) {
      throw new RangeError("staleAfterMs 不能为负数");
    }
  }

  get running(): number {
    return this.runningJobs.size;
  }

  /** 常驻循环；`stop()` 后退出。 */
  async start(): Promise<void> {
    if (this.started) {
      throw new Error("作业 worker 已启动");
    }
    this.started = true;
    this.stopping = false;
    let lastReclaimAt = 0;

    try {
      while (!this.stopping) {
        // 一轮领取失败不等于永远跑不了：数据库短暂不可用之后，worker 要能自己接着走。
        try {
          if (this.staleAfterMs > 0 && Date.now() - lastReclaimAt >= this.reclaimIntervalMs) {
            const reclaimed = await this.store.reclaimStale(
              new Date(Date.now() - this.staleAfterMs),
            );
            if (reclaimed.length > 0) {
              this.logger.warn(`回收失联作业 ${reclaimed.length} 个: ${reclaimed.join(", ")}`);
            }
            lastReclaimAt = Date.now();
          }

          while (!this.stopping && this.runningJobs.size < this.concurrency) {
            const job = await this.store.claimNext({
              queues: this.queues,
              workerId: this.workerId,
            });
            if (!job) {
              break;
            }
            this.track(this.process(job));
          }
        } catch (error) {
          this.logger.warn("作业轮询失败，下一轮继续", error);
        }

        if (this.stopping) {
          break;
        }
        await this.sleep(this.pollIntervalMs);
      }

      await Promise.allSettled([...this.runningJobs]);
    } finally {
      this.started = false;
    }
  }

  /** 领取并执行一轮，返回本轮领取的作业数；供测试与一次性 worker 使用。 */
  async runOnce(): Promise<number> {
    const jobs: JobRecord[] = [];
    while (jobs.length < this.concurrency) {
      const job = await this.store.claimNext({
        queues: this.queues,
        workerId: this.workerId,
      });
      if (!job) {
        break;
      }
      jobs.push(job);
    }

    await Promise.all(jobs.map((job) => this.process(job)));
    return jobs.length;
  }

  /** 停止领取，abort 正在执行的 handler，并等待它们落定。 */
  async stop(): Promise<void> {
    this.stopping = true;
    this.stopController.abort();
    for (const controller of this.controllers) {
      controller.abort(new Error("worker stopping"));
    }
    await Promise.allSettled([...this.runningJobs]);
  }

  private track(job: Promise<void>): void {
    let tracked: Promise<void>;
    tracked = job
      .catch((error: unknown) => {
        // 执行边界已经自己兜过一次；这里只是不让漏网的 rejection 变成未处理异常。
        this.logger.error("作业执行异常", error);
      })
      .finally(() => {
        this.runningJobs.delete(tracked);
      });
    this.runningJobs.add(tracked);
  }

  private async sleep(ms: number): Promise<void> {
    try {
      await delay(ms, undefined, { signal: this.stopController.signal });
    } catch {
      // stop() 会中断轮询等待。
    }
  }

  private async process(job: JobRecord): Promise<void> {
    const controller = new AbortController();
    this.controllers.add(controller);
    const heartbeat = this.startHeartbeat(job.jobId);
    let timeout: NodeJS.Timeout | undefined;

    try {
      const definition = this.registry.get(job.kind);
      if (!definition) {
        await this.store.fail(
          job.jobId,
          this.workerId,
          `作业未注册: ${job.kind}`,
          "job_unregistered",
        );
        this.logger.error(`作业未注册: kind=${job.kind} jobId=${job.jobId}`);
        return;
      }

      const parsed = definition.payload.safeParse(job.payload);
      if (!parsed.success) {
        await this.store.fail(
          job.jobId,
          this.workerId,
          `payload 校验失败: ${JSON.stringify(parsed.error.issues)}`,
          "job_payload_invalid",
        );
        this.logger.error(`payload 校验失败: kind=${job.kind} jobId=${job.jobId}`);
        return;
      }

      if (definition.timeoutMs !== undefined) {
        timeout = setTimeout(() => {
          controller.abort(new Error(`作业超时: ${definition.timeoutMs}ms`));
        }, definition.timeoutMs);
        timeout.unref();
      }

      const context: JobContext = {
        jobId: job.jobId,
        kind: job.kind,
        queue: job.queue,
        attempt: job.attempts,
        maxAttempts: job.maxAttempts,
        signal: controller.signal,
        logger: this.logger,
        // 进度是尽力而为：上报失败只留一行 warn，不让一个已经落账的回合因此判失败。
        reportProgress: async (step: string, detail?: string) => {
          try {
            await this.store.setProgress(job.jobId, this.workerId, {
              step,
              ...(detail === undefined ? {} : { detail }),
            });
          } catch (error) {
            this.logger.warn(`作业进度上报失败: jobId=${job.jobId} step=${step}`, error);
          }
        },
      };

      try {
        const result = await definition.run(parsed.data, context);
        const completed = await this.store.complete(
          job.jobId,
          this.workerId,
          this.normalizeResult(result, job),
        );
        if (completed) {
          this.logger.info(`作业完成: kind=${job.kind} jobId=${job.jobId}`);
        } else {
          this.logger.warn(`作业完成后租约已失效: kind=${job.kind} jobId=${job.jobId}`);
        }
      } catch (error) {
        await this.handleFailure(job, error);
      }
    } catch (error) {
      this.logger.error(`作业执行边界异常: jobId=${job.jobId}`, error);
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      if (heartbeat !== undefined) {
        clearInterval(heartbeat);
      }
      this.controllers.delete(controller);
    }
  }

  private async handleFailure(job: JobRecord, error: unknown): Promise<void> {
    const message = errorText(error);
    const code = errorCodeOf(error);
    const retryable = !(error instanceof NonRetryableJobError) && job.attempts < job.maxAttempts;

    if (retryable) {
      const delayMs = Math.max(0, this.retryDelayMs(job.attempts));
      const retried = await this.store.retry(
        job.jobId,
        this.workerId,
        message,
        new Date(Date.now() + delayMs),
        code,
      );
      if (retried) {
        this.logger.warn(
          `作业失败，${delayMs}ms 后重试: kind=${job.kind} jobId=${job.jobId} ` +
            `attempt=${job.attempts}/${job.maxAttempts}`,
        );
      } else {
        this.logger.warn(`作业重试时租约已失效: kind=${job.kind} jobId=${job.jobId}`);
      }
      return;
    }

    const failed = await this.store.fail(job.jobId, this.workerId, message, code);
    if (failed) {
      this.logger.error(`作业最终失败: kind=${job.kind} jobId=${job.jobId}`);
    } else {
      this.logger.warn(`作业失败时租约已失效: kind=${job.kind} jobId=${job.jobId}`);
    }
  }

  private startHeartbeat(jobId: string): NodeJS.Timeout | undefined {
    if (this.staleAfterMs <= 0) {
      return undefined;
    }
    const intervalMs = Math.max(1_000, Math.floor(this.staleAfterMs / 3));
    const interval = setInterval(() => {
      void this.store
        .heartbeat(jobId, this.workerId)
        .then((ok) => {
          if (!ok) {
            this.logger.warn(`作业心跳失败，租约可能已失效: jobId=${jobId}`);
          }
        })
        .catch((error: unknown) => {
          this.logger.warn(`作业心跳异常: jobId=${jobId}`, error);
        });
    }, intervalMs);
    interval.unref();
    return interval;
  }

  private normalizeResult(result: unknown, job: JobRecord) {
    if (result === undefined) {
      return null;
    }
    try {
      return toJsonValue(result, `${job.kind}.result`);
    } catch (error) {
      this.logger.warn(`作业结果不是 JSON，已存 null: jobId=${job.jobId}`, error);
      return null;
    }
  }
}
