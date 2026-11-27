/**
 * SSE 连接管理：限几条、活多久、积压多少就断。
 *
 * 这一层只做「别把人拖死」的三件事，不做业务判断：
 *
 * 1. **每个身份同时挂几条流**：到顶就 429，让调用方自己决定收哪一条。按身份而不是按 IP——
 *    局域网里所有设备可能共用同一个出口 IP，而身份是每条流都必须带的。
 * 2. **单条流活多久**：到点主动收尾并发一条 `close`，客户端按 `retry` 重连、带 `since` 补发。
 *    长连接不设寿命，就等于「挂一个断掉的 TCP 不算数」——出事时谁也说不清谁占着。
 * 3. **积压到多少字节就断**：慢消费者（不读的老客户端、被掐了一半的隧道）会让进程一直缓存，
 *    推的是「去看一眼」的提醒而不是流水账，所以断了不丢东西：重连补发就是答案。
 *
 * 计数只在进程内：多实例部署时每个实例各算各的，真要全局限流得放到共享存储那一层——
 * 那一天到来之前，这里的数字只代表「这个进程」。
 */

/** 每个身份同时最多挂几条流。 */
export const MAX_STREAMS_PER_USER = 4;

/** 单条流的最长寿命：到了就收尾，客户端重连再补。 */
export const STREAM_MAX_LIFETIME_MS = 30 * 60_000;

/** 一条流允许积压多少字节：超过就判定为慢消费者。 */
export const STREAM_MAX_BUFFERED_BYTES = 1_000_000;

/**
 * 积压到没到预算。
 *
 * 单独成一个纯函数是为了能测：真去填满内核缓冲造不出来，而这条判定只有一行逻辑，
 * 写错了会变成「永远不断」或者「刚连上就断」。
 */
export function isOverloaded(bufferedBytes: number, budget: number): boolean {
  return bufferedBytes > budget;
}

export type StreamLimits = {
  maxPerUser?: number;
  lifetimeMs?: number;
  maxBufferedBytes?: number;
};

/** 一条流占用的额度；`release` 幂等，重复调用不会把别人的计数减掉。 */
export type StreamLease = { release: () => void };

/**
 * 进程内的连接登记簿。
 *
 * 拿不到额度就是 `undefined`——调用方据此回 429，而不是排队等待：
 * 「等一条流释放」会让请求卡在一个不可预期的时长里，不如让客户端自己重试。
 */
export function createStreamRegistry(limits: StreamLimits = {}) {
  const maxPerUser = limits.maxPerUser ?? MAX_STREAMS_PER_USER;
  const byUser = new Map<string, number>();
  let active = 0;

  return {
    /** 当前进程里挂着的流数。 */
    active: (): number => active,

    open(username: string): StreamLease | undefined {
      const current = byUser.get(username) ?? 0;
      if (current >= maxPerUser) {
        return undefined;
      }
      byUser.set(username, current + 1);
      active += 1;
      let released = false;
      return {
        release: () => {
          if (released) {
            return;
          }
          released = true;
          active -= 1;
          const left = (byUser.get(username) ?? 1) - 1;
          if (left <= 0) {
            byUser.delete(username);
          } else {
            byUser.set(username, left);
          }
        },
      };
    },
  };
}

export type StreamRegistry = ReturnType<typeof createStreamRegistry>;
