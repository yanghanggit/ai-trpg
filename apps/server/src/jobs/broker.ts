/**
 * 作业状态订阅：一条常驻 `LISTEN` 连接，把库里的 `NOTIFY` 转成本进程的广播。
 *
 * 为什么不用进程内事件：worker 与 API 可以分进程（`pnpm job:worker`），多个 API
 * 实例也各自要服务自己的观众。数据库是唯一所有进程都看得见的总线。
 *
 * 三条原则：
 *
 * 1. 通知不是真相。丢了、重启了、连接断了，都只让观众晚一拍——重连后发一次
 *    `resync`，让每个订阅者按自己的游标重查。
 * 2. 订阅者拿到的是「谁变了」，不是「变成什么」。要内容就回库里按主键读，
 *    这样推出去的东西与 `GET jobs/:job` 永远同源。
 * 3. 一条连接管到底。`LISTEN` 需要长期持有，所以自己开 `Client`，不占连接池。
 */

import { Client } from "pg";
import { type Logger, silentLogger } from "../logging";
import { JOBS_CHANNEL, type JobChange, parseJobChange } from "./notify";

/** 订阅者收到的东西：一次状态变更，或「连接重连过，请按游标重查」。 */
export type JobStreamEvent = { type: "change"; change: JobChange } | { type: "resync" };

export type JobChangeBrokerOptions = {
  databaseUrl: string;
  logger?: Logger;
  /** 第 n 次重连前等多久；默认 500ms、1s、2s……最多 30s。 */
  reconnectDelayMs?: (attempt: number) => number;
};

const DEFAULT_RECONNECT_DELAY_MS = (attempt: number): number =>
  Math.min(30_000, 500 * 2 ** Math.max(0, attempt - 1));

export class JobChangeBroker {
  private readonly databaseUrl: string;
  private readonly logger: Logger;
  private readonly reconnectDelayMs: (attempt: number) => number;
  private readonly listeners = new Set<(event: JobStreamEvent) => void>();
  private client: Client | null = null;
  private running = false;
  private attempts = 0;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private connectedOnce = false;

  constructor(options: JobChangeBrokerOptions) {
    this.databaseUrl = options.databaseUrl;
    this.logger = options.logger ?? silentLogger;
    this.reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  }

  /** 是否已经接上数据库；断线期间订阅仍然有效，只是暂时收不到东西。 */
  get connected(): boolean {
    return this.client !== null;
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }

  /** 建立监听；失败不抛——断线重连是常态，先让进程起来。 */
  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    void this.connect();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    const client = this.client;
    this.client = null;
    if (client !== null) {
      try {
        await client.end();
      } catch (error) {
        this.logger.warn("关闭作业通知连接失败", error);
      }
    }
  }

  /** 订阅；返回退订函数。断线期间的变更会在重连后由 `resync` 提示重查。 */
  subscribe(listener: (event: JobStreamEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async connect(): Promise<void> {
    if (!this.running) {
      return;
    }
    const client = new Client({ connectionString: this.databaseUrl });
    client.on("notification", (message) => {
      if (message.channel !== JOBS_CHANNEL || message.payload === undefined) {
        return;
      }
      const change = parseJobChange(message.payload);
      if (change === null) {
        this.logger.warn("忽略无法解析的作业通知");
        return;
      }
      this.emit({ type: "change", change });
    });
    client.on("error", (error) => {
      this.logger.warn("作业通知连接异常，准备重连", error);
      this.dropClient(client);
    });
    client.on("end", () => {
      this.dropClient(client);
    });

    try {
      await client.connect();
      await client.query(`LISTEN ${JOBS_CHANNEL}`);
    } catch (error) {
      this.logger.warn("作业通知订阅失败，稍后重试", error);
      try {
        await client.end();
      } catch {
        // 连不上就没什么可关的。
      }
      this.scheduleReconnect();
      return;
    }

    if (!this.running) {
      await client.end();
      return;
    }
    this.client = client;
    this.attempts = 0;
    if (this.connectedOnce) {
      // 断线期间的通知全丢了：让订阅者按自己的游标补查，别指望推送补齐。
      this.emit({ type: "resync" });
    }
    this.connectedOnce = true;
    this.logger.info("作业通知已订阅");
  }

  private dropClient(client: Client): void {
    if (this.client !== client) {
      return;
    }
    this.client = null;
    if (this.running) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.running || this.reconnectTimer !== undefined) {
      return;
    }
    this.attempts += 1;
    const delayMs = this.reconnectDelayMs(this.attempts);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, delayMs);
    this.reconnectTimer.unref();
  }

  private emit(event: JobStreamEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger.warn("作业通知订阅者抛错，已忽略", error);
      }
    }
  }
}
