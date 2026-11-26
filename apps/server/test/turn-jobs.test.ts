/**
 * 回合作业：入队、串行键、执行与失败码。
 *
 * 只覆盖作业这一层的行为——回合本身怎么结算由 `game` 的用例负责；这里用假服务把
 * worker 跑一轮，确认「入队 → 执行 → 计数 / 结果 / 错误码」这条链闭合。
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { DEMO_USER } from "../src/db/demo-fixture";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import { createGame, getGameMeta } from "../src/game";
import {
  cancelTurnJob,
  createActionOrderOp,
  createTurnJobRegistry,
  enqueueActorTurn,
  enqueuePlayerTurn,
  enqueueStageTurn,
  enqueueWorldTurn,
  listTurnJobs,
  readActionOrderOp,
  readTurnJob,
  TURN_QUEUE,
  takeControlOp,
} from "../src/game-ops";
import { JobStore, JobWorker } from "../src/jobs";
import { ChatCompletionResult, type ChatCompletionService } from "../src/llm";
import { TEST_WORLD } from "./test-world";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

/** 只提交一个动作的 actor 服务：计划能被接受，世界不变。 */
class WaitService implements ChatCompletionService {
  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    const toolCalls = [
      { id: "call-1", type: "function" as const, function: { name: "wait", arguments: "{}" } },
      {
        id: "call-2",
        type: "function" as const,
        function: { name: "submit_plan", arguments: "{}" },
      },
    ];
    return new ChatCompletionResult({
      request,
      aiMessage: { type: "ai", content: "", toolCalls },
      finishReason: "tool_calls",
      toolCalls,
    });
  }
}

/** 只提交该层的空计划：舞台 / world 回合允许这一轮没有变化。 */
class EmptyPlanService implements ChatCompletionService {
  constructor(private readonly tool: "submit_stage_plan" | "submit_world_plan") {}

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    const toolCalls = [
      {
        id: "call-1",
        type: "function" as const,
        function: { name: this.tool, arguments: "{}" },
      },
    ];
    return new ChatCompletionResult({
      request,
      aiMessage: { type: "ai", content: "", toolCalls },
      finishReason: "tool_calls",
      toolCalls,
    });
  }
}

/**
 * 一直卡在模型调用上，直到信号被掐断：用来验证「执行中取消」真的中断了等待，
 * 而不是干等它自己返回。
 */
class BlockingService implements ChatCompletionService {
  started = false;
  private notifyStarted: (() => void) | undefined;
  readonly isStarted = new Promise<void>((resolve) => {
    this.notifyStarted = resolve;
  });

  async complete(
    request: Parameters<ChatCompletionService["complete"]>[0],
  ): Promise<ChatCompletionResult> {
    this.started = true;
    this.notifyStarted?.();
    const signal = request.signal;
    if (signal === undefined) {
      throw new Error("阻塞服务需要取消信号");
    }
    await new Promise<never>((_, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    // 上面永远 reject；这行只为满足返回类型。
    throw new Error("不可达");
  }
}

describe.skipIf(!testDatabaseUrl)("回合作业", () => {
  let handle: DatabaseHandle;

  beforeAll(async () => {
    handle = openDatabase("TEST_DATABASE_URL");
    await runMigrations(handle.db);
    await resetDomainData(handle.db);
    await seedDemoData(handle.db);
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  async function freshGame(name: string) {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name,
      world: TEST_WORLD,
    });
    return created.game.slug;
  }

  function makeWorker(service: ChatCompletionService): JobWorker {
    return new JobWorker({
      store: new JobStore(handle.db),
      registry: createTurnJobRegistry({
        db: () => handle.db,
        services: () => ({ service, inferenceService: service }),
      }),
      queues: [TURN_QUEUE],
      // 测试里等不了默认的 1 秒：取消检查点调紧。
      cancelPollIntervalMs: 10,
    });
  }

  /** 用给定服务跑一轮 worker；返回处理掉的作业数。 */
  async function drain(service: ChatCompletionService = new WaitService()): Promise<number> {
    return makeWorker(service).runOnce();
  }

  it("入队即返回，执行后落账并给顺位 +1", async () => {
    const game = await freshGame("回合作业基本局");
    const { order } = await createActionOrderOp(handle.db, game);
    const lead = order.entries[0];
    if (!lead) {
      throw new Error("顺位没有条目");
    }

    const job = await enqueueActorTurn(handle.db, game, { actor: lead.actorName });
    expect(job).toMatchObject({
      kind: "turn.actor.npc",
      status: "pending",
      attempts: 0,
      maxAttempts: 1,
      serializationKey: `turn:${(await getGameMeta(handle.db, game)).id}`,
    });

    expect(await drain()).toBe(1);

    const view = await readTurnJob(handle.db, game, job.jobId);
    expect(view).toMatchObject({
      status: "succeeded",
      error: null,
      errorCode: null,
      // NPC 回合跑完最后停在这一格：出计划 → 落账 → 收尾。
      progress: { step: "finalizing" },
      result: { ok: true, actions: ["wait"] },
    });
    const after = (await readActionOrderOp(handle.db, game)).order;
    expect(after?.entries[0]?.turnsTaken).toBe(1);
  });

  it("同一局已有回合在跑时，第二个入队被拒；跑完释放", async () => {
    const game = await freshGame("回合作业串行局");
    const { order } = await createActionOrderOp(handle.db, game);
    const lead = order.entries[0];
    if (!lead) {
      throw new Error("顺位没有条目");
    }

    await enqueueActorTurn(handle.db, game, { actor: lead.actorName });
    await expect(enqueueActorTurn(handle.db, game, { actor: lead.actorName })).rejects.toThrow(
      "已有回合在跑",
    );

    expect(await drain()).toBe(1);
    // 终态释放串行键：下一条照常入队，跑掉它，免得留给下个用例。
    await expect(
      enqueueActorTurn(handle.db, game, { actor: lead.actorName }),
    ).resolves.toMatchObject({ status: "pending" });
    expect(await drain()).toBe(1);
  });

  it("列这一局的活跃作业，并按局隔离", async () => {
    const game = await freshGame("回合作业列表局");
    const other = await freshGame("回合作业列表局-别局");
    const { order } = await createActionOrderOp(handle.db, game);
    const lead = order.entries[0];
    if (!lead) {
      throw new Error("顺位没有条目");
    }

    const queued = await enqueueActorTurn(handle.db, game, { actor: lead.actorName });
    const active = await listTurnJobs(handle.db, game);
    expect(active.map((job) => job.jobId)).toEqual([queued.jobId]);
    // 别局看不到这条：作业只对本局可见。
    expect(await listTurnJobs(handle.db, other)).toHaveLength(0);

    await drain();
    // 默认只列活跃的；跑完就不在列表里了。
    expect(await listTurnJobs(handle.db, game)).toHaveLength(0);
    const history = await listTurnJobs(handle.db, game, { activeOnly: false });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ status: "succeeded", result: { ok: true } });
  });

  it("排队中的回合可以取消，撤掉后串行键释放", async () => {
    const game = await freshGame("回合作业取消局");
    const { order } = await createActionOrderOp(handle.db, game);
    const lead = order.entries[0];
    if (!lead) {
      throw new Error("顺位没有条目");
    }

    const job = await enqueueActorTurn(handle.db, game, { actor: lead.actorName });
    const canceled = await cancelTurnJob(handle.db, game, job.jobId);
    expect(canceled).toMatchObject({ ok: true, job: { status: "canceled" } });

    // 终态不再占串行键。
    await expect(
      enqueueActorTurn(handle.db, game, { actor: lead.actorName }),
    ).resolves.toMatchObject({ status: "pending" });
    expect(await drain()).toBe(1);

    // 已经到终态的没有可撤的。
    expect(await cancelTurnJob(handle.db, game, job.jobId)).toEqual({
      ok: false,
      reason: "finished",
    });
    expect(await cancelTurnJob(handle.db, game, "not-a-uuid")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("执行中取消：中断模型调用、不落账、计数不变", async () => {
    const game = await freshGame("回合作业执行中取消局");
    const { order } = await createActionOrderOp(handle.db, game);
    const lead = order.entries[0];
    if (!lead) {
      throw new Error("顺位没有条目");
    }

    const service = new BlockingService();
    const job = await enqueueActorTurn(handle.db, game, { actor: lead.actorName });
    const running = makeWorker(service).runOnce();
    await service.isStarted;

    // 请求取消：作业已在跑，所以是「请求」而不是「当场撤」。
    const requested = await cancelTurnJob(handle.db, game, job.jobId);
    expect(requested).toMatchObject({ ok: true, outcome: "requested" });
    expect(requested.ok && requested.job.cancelRequested).toBe(true);

    expect(await running).toBe(1);

    const view = await readTurnJob(handle.db, game, job.jobId);
    expect(view).toMatchObject({
      status: "canceled",
      errorCode: "job_canceled",
      cancelRequested: true,
      result: null,
    });
    // 没落账，顺位不计数——取消不是「跑完一个空回合」。
    const after = (await readActionOrderOp(handle.db, game)).order;
    expect(after?.entries[0]?.turnsTaken).toBe(0);
  });

  it("执行期间上报阶段，终态仍以行为准", async () => {
    const game = await freshGame("回合作业进度局");
    await takeControlOp(handle.db, game, "守烬人");

    const job = await enqueuePlayerTurn(handle.db, game, {
      actor: "守烬人",
      action: { kind: "wait" },
    });
    expect(await drain()).toBe(1);

    // 玩家回合的计划是客户端给的：只有落账这一步，没有 planning / finalizing。
    const view = await readTurnJob(handle.db, game, job.jobId);
    expect(view).toMatchObject({ status: "succeeded", progress: { step: "applying" } });
  });

  it("视图过期在执行时判失败，带机器可读的错误码", async () => {
    const game = await freshGame("回合作业视图局");
    const meta = await getGameMeta(handle.db, game);

    const job = await enqueueActorTurn(handle.db, game, {
      actor: "守烬人",
      expectedVersion: meta.version + 1,
    });
    expect(await drain()).toBe(1);

    const view = await readTurnJob(handle.db, game, job.jobId);
    expect(view).toMatchObject({
      status: "failed",
      errorCode: "stale_view",
      result: null,
    });
    expect(view?.error).toContain("视图已过期");
    // 失败不计数：顺位还是空的。
    expect((await readActionOrderOp(handle.db, game)).order).toBeNull();
  });

  it("玩家动作也是作业：一个动作一个回合，计数同样 +1", async () => {
    const game = await freshGame("回合作业玩家局");
    const { order } = await createActionOrderOp(handle.db, game);
    const lead = order.entries[0];
    if (!lead) {
      throw new Error("顺位没有条目");
    }
    await takeControlOp(handle.db, game, lead.actorName);

    const job = await enqueuePlayerTurn(handle.db, game, {
      actor: lead.actorName,
      action: { kind: "wait" },
    });
    expect(await drain()).toBe(1);

    expect(await readTurnJob(handle.db, game, job.jobId)).toMatchObject({
      status: "succeeded",
      result: { ok: true, actions: ["wait"] },
    });
    const after = (await readActionOrderOp(handle.db, game)).order;
    expect(after?.entries[0]?.turnsTaken).toBe(1);
  });

  it("舞台与 world 回合也走作业", async () => {
    const game = await freshGame("回合作业分层局");
    const stage = TEST_WORLD.stages[0];
    if (!stage) {
      throw new Error("测试世界没有舞台");
    }

    const stageJob = await enqueueStageTurn(handle.db, game, { stage: stage.name });
    expect(await drain(new EmptyPlanService("submit_stage_plan"))).toBe(1);
    expect(await readTurnJob(handle.db, game, stageJob.jobId)).toMatchObject({
      status: "succeeded",
      result: { ok: true },
    });

    const worldJob = await enqueueWorldTurn(handle.db, game, {});
    expect(await drain(new EmptyPlanService("submit_world_plan"))).toBe(1);
    expect(await readTurnJob(handle.db, game, worldJob.jobId)).toMatchObject({
      status: "succeeded",
      result: { ok: true },
    });
  });

  it("作业只对本局可见", async () => {
    const game = await freshGame("回合作业归属局");
    const other = await freshGame("回合作业别人的局");
    const job = await enqueueActorTurn(handle.db, game, { actor: "守烬人" });
    expect(await readTurnJob(handle.db, other, job.jobId)).toBeNull();
  });
});
