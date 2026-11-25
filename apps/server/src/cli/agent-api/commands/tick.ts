/**
 * `tick`：客户端自己编排的一次推进循环，不对应单个端点。
 *
 * 逐 stage 推该 stage 上名次最靠前的 agent 回合，再推一次 stage；全部走完推一次 world。
 * 服务器没有 tick 这个概念，这些先后关系只在这里——手点同样的顺序也能走完。
 * 用法见 `--help`。
 */

import { z } from "zod";
import { gameOption, optionalOption } from "../../args";
import { note } from "../../io";
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

/**
 * 这个 stage 该推谁：该 stage 上活着、由 agent 执行的条目里回合最少者，同值取名次靠前。
 * 与服务器算 `nextActor` 的口径一致，只是范围收到一个 stage。
 */
function pick(stage: Snapshot["stages"][number], order: Order): Entry | undefined {
  let picked: Entry | undefined;
  for (const entry of order.entries) {
    if (!entry.alive || entry.control !== "agent") {
      continue;
    }
    if (!stage.actorIds.includes(entry.actorId)) {
      continue;
    }
    if (picked === undefined || entry.turnsTaken < picked.turnsTaken) {
      picked = entry;
    }
  }
  return picked;
}

export function registerTickCommand(program: Parameters<typeof addApiCommand>[0]): void {
  addApiCommand(program, {
    name: "tick",
    group: "编排",
    summary: "客户端自己编排一个 tick：逐 stage 推一个 actor 回合，再推 stage，最后推 world",
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
        return { status: state.game.status, version: state.game.version, stages };
      };

      const readOrder = async (): Promise<Order | null> =>
        unwrap<Order | null>(
          await client.call({ method: "GET", path: `${gamePath}/action-orders/current` }),
          "order",
        );

      if (input.open === true && (await readOrder()) === null) {
        await client.call({ method: "POST", path: `${gamePath}/action-orders` });
        note("开了一条行动顺位");
      }

      let advanced = 0;
      let planned = 0;
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
        const stages =
          wanted.length === 0
            ? state.stages
            : state.stages.filter(
                (stage) => wanted.includes(stage.id) || wanted.includes(stage.name),
              );
        if (stages.length === 0) {
          throw new Error(`没有匹配的 stage：${wanted.join(", ")}`);
        }

        note(`[tick ${index}] v${state.version}「${state.status}」${stages.length} 个 stage`);
        for (const stage of stages) {
          // 推进与 stage 回合都会改世界版本，所以每步重读顺位；拿旧版本会撞 409。
          const order = await readOrder();
          if (order === null) {
            throw new Error("没有进行中的行动顺位：先开一条，或加 --open");
          }
          const picked = pick(stage, order);
          if (picked === undefined) {
            note(`  ${stage.name}: 没有可执行的 agent actor，只推 stage`);
          } else {
            note(
              `  ${stage.name}: 推进 ${picked.actorName}（名次 ${picked.position}，` +
                `这一回合数到 ${picked.turnsTaken + 1}）`,
            );
            planned += 1;
            if (!dryRun) {
              await client.call({
                method: "POST",
                path: `${gamePath}/turns/npc`,
                body: { actors: [picked.actorName], expectedVersion: order.gameVersion },
              });
              advanced += 1;
            }
          }
          note(`  ${stage.name}: stage 回合`);
          if (!dryRun) {
            await client.call({
              method: "POST",
              path: `${gamePath}/turns/stage`,
              body: { stages: [stage.id] },
            });
          }
        }
        note("  world 回合");
        if (!dryRun) {
          await client.call({ method: "POST", path: `${gamePath}/turns/world`, body: {} });
          const after = await readOrder();
          if (after !== null) {
            note(`[tick ${index}] 顺位：${tally(after)}`);
          }
        }
      }

      return { game: input.game, ticks, planned, advanced, dryRun };
    },
  });
}
