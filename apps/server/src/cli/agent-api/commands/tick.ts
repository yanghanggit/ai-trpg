/**
 * `tick`：客户端自己编排的一次推进循环，不对应单个端点。
 *
 * 按顺位从头到尾逐个 actor：推一个回合，就推一次它所在的 stage；全走完推一次 world。
 * 服务器没有 tick 这个概念，这些先后关系只在这里——手点同样的顺序也能走完。
 */

import { z } from "zod";
import { gameOption, optionalOption } from "../../args";
import { note } from "../../io";
import { ApiFailure } from "../client";
import { addApiCommand } from "../command";

type Entry = {
  actorId: string;
  actorName: string;
  position: number;
  turnsTaken: number;
  control: "agent" | "player";
  alive: boolean;
};

type Order = { id: string; gameVersion: number; entries: Entry[] };

/** `/state` 是控制面投影，只取 tick 需要的事实，不整份建模。 */
type Snapshot = {
  status: string;
  version: number;
  stages: { id: string; name: string; actorIds: string[] }[];
  stageOf: Map<string, { id: string; name: string }>;
};

const tickInput = z.object({
  game: z.string(),
  ticks: z.coerce.number().int().positive().optional(),
  interval: z.coerce.number().int().nonnegative().optional(),
  open: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  stage: z.array(z.string().trim().min(1)).optional(),
});

function unwrap<T>(payload: unknown, key: string): T {
  const record = typeof payload === "object" && payload !== null ? payload : {};
  const value = (record as Record<string, unknown>)[key];
  if (value === undefined) {
    throw new Error(`响应里没有 ${key}：${JSON.stringify(payload).slice(0, 200)}`);
  }
  return value as T;
}

/** 顺位概览：名次、执行方、计数，死者标 `†`。 */
function tally(order: Order): string {
  return order.entries
    .map((entry) => {
      const mark = entry.alive ? "" : "†";
      const who = entry.control === "player" ? "玩家" : "agent";
      return `#${entry.position}${mark}(${who}):${entry.turnsTaken}`;
    })
    .join(" ");
}

/** 视图过期是 tick 自己的簿记错，不是这个 actor 的失败。 */
function isStaleView(error: unknown): boolean {
  return (
    error instanceof ApiFailure && error.status === 409 && error.message.includes("视图已过期")
  );
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 这一趟要轮到的人：顺位上还活着的条目，回合少的在前，同值按名次。玩家席位也在内。 */
function queue(order: Order): Entry[] {
  return order.entries
    .filter((entry) => entry.alive)
    .sort((left, right) => left.turnsTaken - right.turnsTaken || left.position - right.position);
}

export function registerTickCommand(program: Parameters<typeof addApiCommand>[0]): void {
  addApiCommand(program, {
    name: "tick",
    group: "编排",
    summary:
      "客户端自己编排一个 tick：按顺位逐个 actor 推回合，行动完推它所在的 stage，最后推 world",
    options: [
      gameOption(),
      optionalOption("--ticks <n>", "跑几个 tick，默认 1"),
      optionalOption("--interval <ms>", "两个 tick 之间停多久，默认 0"),
      optionalOption("--open", "没有进行中的顺位时先开一条"),
      optionalOption("--dry-run", "只打印会怎么走，不发推进请求"),
      optionalOption("--stage <refs...>", "只编排这些 stage（id 或名字），可重复"),
    ],
    schema: tickInput,
    run: async (input, client) => {
      const ticks = input.ticks ?? 1;
      const intervalMs = input.interval ?? 0;
      const dryRun = input.dryRun ?? false;
      const gamePath = `/games/${encodeURIComponent(input.game)}`;

      const snapshot = async (): Promise<Snapshot> => {
        const state = unwrap<{
          game: { status: string; version: number };
          world: { stages: { id: string; name: string; actors: { id: string }[] }[] };
        }>(await client.call({ method: "GET", path: `${gamePath}/state` }), "state");
        const stages = state.world.stages.map((stage) => ({
          id: stage.id,
          name: stage.name,
          actorIds: stage.actors.map((actor) => actor.id),
        }));
        const stageOf = new Map<string, { id: string; name: string }>(
          stages.flatMap((stage) =>
            stage.actorIds.map((actorId) => [actorId, { id: stage.id, name: stage.name }] as const),
          ),
        );
        return { status: state.game.status, version: state.game.version, stages, stageOf };
      };

      const readOrder = async (): Promise<Order | null> =>
        unwrap<Order | null>(
          await client.call({ method: "GET", path: `${gamePath}/action-orders/current` }),
          "order",
        );

      /** 推一个回合；失败时回一句原因，`null` 表示落账了。视图过期重读一次再试。 */
      const advance = async (name: string, expectedVersion: number): Promise<string | null> => {
        try {
          await client.call({
            method: "POST",
            path: `${gamePath}/turns/npc`,
            body: { actors: [name], expectedVersion },
          });
          return null;
        } catch (error) {
          if (!isStaleView(error)) {
            return reason(error);
          }
          const fresh = await readOrder();
          if (fresh === null) {
            return reason(error);
          }
          try {
            await client.call({
              method: "POST",
              path: `${gamePath}/turns/npc`,
              body: { actors: [name], expectedVersion: fresh.gameVersion },
            });
            return null;
          } catch (retry) {
            return reason(retry);
          }
        }
      };

      const passStage = async (names: string[]): Promise<void> => {
        await client.call({
          method: "POST",
          path: `${gamePath}/turns/pass`,
          body: { actors: names },
        });
      };

      /** 回合是否已经落账：比一次计数，避免超时之后又补一个空回合记成两次。 */
      const counted = async (was: Order, actorId: string): Promise<boolean> => {
        const now = await readOrder();
        const before = was.entries.find((item) => item.actorId === actorId)?.turnsTaken ?? 0;
        const after = now?.entries.find((item) => item.actorId === actorId)?.turnsTaken ?? 0;
        return after > before;
      };

      if (input.open === true && (await readOrder()) === null) {
        await client.call({ method: "POST", path: `${gamePath}/action-orders` });
        note("开了一条行动顺位");
      }

      let advanced = 0;
      let planned = 0;
      let passed = 0;
      let skipped = 0;
      for (let index = 1; index <= ticks; index += 1) {
        if (index > 1 && intervalMs > 0) {
          await new Promise((done) => setTimeout(done, intervalMs));
        }
        const state = await snapshot();
        if (state.status !== "active") {
          note(`[tick ${index}] 游戏已结束（${state.status}），收工`);
          break;
        }

        const wanted = input.stage ?? [];
        const matches = (stage: { id: string; name: string }) =>
          wanted.length === 0 || wanted.includes(stage.id) || wanted.includes(stage.name);

        const before = await readOrder();
        if (before === null) {
          throw new Error("没有进行中的行动顺位：先开一条，或加 --open");
        }
        // 名单在这一刻定下来：一个 tick 就是线上每人各一个回合，中途加入的不追认。
        const batch = queue(before).filter((entry) => {
          const stage = state.stageOf.get(entry.actorId);
          return stage !== undefined && matches(stage);
        });
        if (wanted.length > 0 && batch.length === 0) {
          throw new Error(`这些 stage 上没有可执行的 actor：${wanted.join(", ")}`);
        }
        // 起点的计数：用来认「这一趟他已经行动过了」，避免补空回合补成两次。
        const start = new Map(batch.map((entry) => [entry.actorId, entry.turnsTaken]));

        note(`[tick ${index}] v${state.version}「${state.status}」${batch.length} 个 actor`);
        for (const entry of batch) {
          // 推进与 stage 回合都会改世界版本，所以每步重读顺位；拿旧版本会撞 409。
          const order = await readOrder();
          if (order === null) {
            throw new Error("行动顺位在 tick 中途被移除");
          }
          const stage = state.stageOf.get(entry.actorId);
          const current = order.entries.find((item) => item.actorId === entry.actorId);
          if (stage === undefined) {
            continue;
          }
          if (current === undefined || !current.alive) {
            note(`  ${stage.name}: ${entry.actorName} 已经不在了，跳过`);
            skipped += 1;
            continue;
          }
          if (current.turnsTaken > (start.get(entry.actorId) ?? 0)) {
            note(`  ${stage.name}: ${entry.actorName} 这一趟已经行动过，跳过`);
            continue;
          }

          if (dryRun) {
            note(`  ${stage.name}: 会轮到 ${entry.actorName}（名次 ${entry.position}）`);
            planned += 1;
            continue;
          }

          // 玩家席位不跑模型：人没动手就是空回合，照样计数，下一轮不堵在队首。
          if (current.control === "player") {
            await passStage([entry.actorName]);
            note(`  ${stage.name}: ${entry.actorName} 空回合（玩家待机）`);
            passed += 1;
            continue;
          }

          note(
            `  ${stage.name}: 推进 ${entry.actorName}（名次 ${entry.position}，` +
              `这一回合数到 ${current.turnsTaken + 1}）`,
          );
          planned += 1;
          const failure = await advance(entry.actorName, order.gameVersion);
          if (failure === null) {
            advanced += 1;
          } else if (await counted(order, entry.actorId)) {
            // 超时或连接断了，但回合其实落了账：不能补空回合，否则同一回合 +2。
            advanced += 1;
            note(`  ${stage.name}: ${entry.actorName} 的回合已落账（${failure}）`);
          } else {
            await passStage([entry.actorName]);
            note(`  ${stage.name}: ${entry.actorName} 空回合（${failure}）`);
            passed += 1;
          }
          note(`  ${stage.name}: stage 回合`);
          try {
            await client.call({
              method: "POST",
              path: `${gamePath}/turns/stage`,
              body: { stages: [stage.id] },
            });
          } catch (error) {
            note(`  ${stage.name}: stage 回合失败（${reason(error)}），继续下一个`);
            skipped += 1;
          }
        }
        note("  world 回合");
        if (!dryRun) {
          try {
            await client.call({ method: "POST", path: `${gamePath}/turns/world`, body: {} });
          } catch (error) {
            note(`  world 回合失败（${reason(error)}）`);
            skipped += 1;
          }
          const after = await readOrder();
          if (after !== null) {
            note(`[tick ${index}] 顺位：${tally(after)}`);
          }
        }
      }

      return { game: input.game, ticks, planned, advanced, passed, skipped, dryRun };
    },
  });
}
