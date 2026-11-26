/**
 * 回合作业：一条回合一个作业，入队即返回，执行在 HTTP 请求之外。
 *
 * 三个回合层（actor / stage / world）与玩家动作共用一套 payload 契约与同一把串行键：
 * 同一局同一时刻只有一个回合在跑，冲突由 `jobs_active_serialization_unique` 兜住。
 * 作业不排队等前一个，冲突直接回 409——「这一局有回合在跑」是客户端该看见的事实。
 *
 * 计数与落账仍在原来的 ops 里：作业只是执行载体，入队成功不等于回合发生过。
 */

import { z } from "zod";
import type { Database } from "../db/pool";
import type { TurnStepReporter } from "../game";
import { GameError, getGameMeta } from "../game";
import {
  ACTIVE_JOB_STATUSES,
  defineJob,
  JobCanceledError,
  type JobContext,
  type JobDefinition,
  type JobProgress,
  JobRegistry,
  JobSerializationConflictError,
  type JobSnapshot,
  JobStore,
  toJsonValue,
} from "../jobs";
import { ChatCompletionRequest, type ChatCompletionService } from "../llm";
import {
  advanceNpc,
  advanceStage,
  advanceWorld,
  assertExpectedVersion,
  submitPlayerAction,
} from "./play";
import { type PlayerActionRequest, playerActionBodySchema } from "./player-action";
import type { LlmServices, TurnServices } from "./services";

/** 作业 kind：稳定标识，注册表按它分派，查询与轨迹按它筛。 */
export const TURN_JOB = {
  /** 引擎跑循环的 actor 回合。 */
  actorNpc: "turn.actor.npc",
  /** 玩家接管的 actor 回合：客户端已经决定好了一个动作。 */
  actorPlayer: "turn.actor.player",
  stage: "turn.stage",
  world: "turn.world",
} as const;

/** 队列名：回合作业在这里排，worker 按它分流。 */
export const TURN_QUEUE = "turns";

const gameId = z.string().trim().min(1);
const expectedVersion = z.number().int().min(0).optional();

const npcPayload = z.object({ gameId, actorName: z.string().trim().min(1), expectedVersion });
const playerPayload = z.object({
  gameId,
  actorName: z.string().trim().min(1),
  action: playerActionBodySchema,
  expectedVersion,
});
const stagePayload = z.object({ gameId, stageRef: z.string().trim().min(1), expectedVersion });
const worldPayload = z.object({ gameId, expectedVersion });

/** 作业结果只放摘要：活状态与事件流由客户端重读，不塞进作业行。 */
export type TurnJobResult = {
  ok: boolean;
  /** 回合结束时公共事件流里最大的序号；没有事件时为 0。 */
  messageCursor?: number;
  /** 这一回合实际落账的动作种类，供调用方核对。 */
  actions?: string[];
};

export type TurnJobDeps = {
  db: () => Database;
  /** 每个作业取一次：worker 常驻，服务实例由调用方持有。 */
  services: () => TurnServices;
};

/** 显式注册四个回合作业；worker 不认识未注册的 kind，直接标记失败。 */
export function createTurnJobRegistry(deps: TurnJobDeps): JobRegistry {
  const [npc, player, stage, world] = turnJobDefinitions(deps);
  return new JobRegistry().register(npc).register(player).register(stage).register(world);
}

/**
 * 串行键：一局一把锁，不分 actor 与舞台层。
 *
 * 顺位、stage、world 的先后由客户端决定；服务器能保证的是「同时只有一件事在改这个世界」，
 * 所以键取局而不是实体——两发并发改同一局，无论改的是不是同一个 actor，都会撞锁。
 */
export function turnSerializationKey(gameId: string): string {
  return `turn:${gameId}`;
}

function turnJobDefinitions(
  deps: TurnJobDeps,
): [
  JobDefinition<z.infer<typeof npcPayload>, TurnJobResult>,
  JobDefinition<z.infer<typeof playerPayload>, TurnJobResult>,
  JobDefinition<z.infer<typeof stagePayload>, TurnJobResult>,
  JobDefinition<z.infer<typeof worldPayload>, TurnJobResult>,
] {
  return [
    defineJob({
      name: TURN_JOB.actorNpc,
      payload: npcPayload,
      run: (payload, context) => runNpcTurn(deps, payload, context),
    }),
    defineJob({
      name: TURN_JOB.actorPlayer,
      payload: playerPayload,
      run: (payload, context) => runPlayerTurn(deps, payload, context),
    }),
    defineJob({
      name: TURN_JOB.stage,
      payload: stagePayload,
      run: (payload, context) => runStageTurn(deps, payload, context),
    }),
    defineJob({
      name: TURN_JOB.world,
      payload: worldPayload,
      run: (payload, context) => runWorldTurn(deps, payload, context),
    }),
  ];
}

async function runNpcTurn(
  deps: TurnJobDeps,
  payload: z.infer<typeof npcPayload>,
  context: JobContext,
): Promise<TurnJobResult> {
  const db = deps.db();
  await assertExpectedVersion(db, payload.gameId, payload.expectedVersion);
  const guard = cancelGuard(context);
  // 先开个头，逐轮进度由引擎覆盖。
  await context.reportProgress("planning");
  const { results } = await advanceNpc(
    db,
    payload.gameId,
    { actors: [payload.actorName] },
    guard.services(deps.services()),
  );
  const result = results[0];
  if (result === undefined) {
    throw new GameError("invalid_state", `回合没有产出: ${payload.actorName}`);
  }
  return {
    ok: result.ok,
    messageCursor: result.messageCursor,
    actions: result.plan?.actions.map((action) => action.kind) ?? [],
  };
}

async function runPlayerTurn(
  deps: TurnJobDeps,
  payload: z.infer<typeof playerPayload>,
  context: JobContext,
): Promise<TurnJobResult> {
  const db = deps.db();
  await assertExpectedVersion(db, payload.gameId, payload.expectedVersion);
  const guard = cancelGuard(context);
  // 玩家回合没有「出计划」这一步；台词审核仍在窗口内，落账时才关窗。
  await context.reportProgress("applying");
  guard.throwIfCanceled();
  const output = await submitPlayerAction(
    db,
    payload.gameId,
    payload.actorName,
    payload.action,
    guard.services(deps.services()),
  );
  return {
    ok: true,
    messageCursor: output.messageCursor,
    actions: output.plan?.actions.map((action) => action.kind) ?? [],
  };
}

async function runStageTurn(
  deps: TurnJobDeps,
  payload: z.infer<typeof stagePayload>,
  context: JobContext,
): Promise<TurnJobResult> {
  const db = deps.db();
  await assertExpectedVersion(db, payload.gameId, payload.expectedVersion);
  const guard = cancelGuard(context);
  await context.reportProgress("planning");
  const { results } = await advanceStage(
    db,
    payload.gameId,
    { stages: [payload.stageRef] },
    guard.llm(llmServicesOf(deps.services())),
  );
  const result = results[0];
  if (result === undefined) {
    throw new GameError("invalid_state", `舞台回合没有产出: ${payload.stageRef}`);
  }
  return { ok: result.ok, messageCursor: result.messageCursor };
}

async function runWorldTurn(
  deps: TurnJobDeps,
  payload: z.infer<typeof worldPayload>,
  context: JobContext,
): Promise<TurnJobResult> {
  const db = deps.db();
  await assertExpectedVersion(db, payload.gameId, payload.expectedVersion);
  const guard = cancelGuard(context);
  await context.reportProgress("planning");
  const result = await advanceWorld(db, payload.gameId, guard.llm(llmServicesOf(deps.services())));
  return { ok: result.ok, messageCursor: result.messageCursor };
}

/**
 * 取消守卫：可撤窗口到落账开始为止（`onStep("applying")` 关窗）。
 *
 * 窗口内每次模型调用前查信号，调用本身也带着信号，所以在等的那一发会被真正掐断。
 * 关窗后不再中断调用——增量推理在写事务之后，那里抛错会让已落账的回合看起来像失败。
 */
type CancelGuard = {
  services: (services: TurnServices) => TurnServices;
  llm: (services: LlmServices) => LlmServices;
  /** 落账前再查一次：被撤了就抛，不带着旧决定往下走。 */
  throwIfCanceled: () => void;
};

function cancelGuard(context: JobContext): CancelGuard {
  let cancelable = true;

  /** 窗口内的取消检查：被撤了就抛，原因就是信号的 `reason`。 */
  const throwIfCanceled = (): void => {
    if (!cancelable || !context.signal.aborted) {
      return;
    }
    throw context.signal.reason instanceof Error ? context.signal.reason : new JobCanceledError();
  };

  const wrap = (service: ChatCompletionService): ChatCompletionService => ({
    async complete(request) {
      if (!cancelable) {
        return service.complete(request);
      }
      throwIfCanceled();
      return service.complete(new ChatCompletionRequest({ ...request, signal: context.signal }));
    },
  });

  const onStep: TurnStepReporter = (step, detail) => {
    if (step === "applying") {
      throwIfCanceled();
      cancelable = false;
    }
    void context.reportProgress(step, detail);
  };

  return {
    services: (services) => ({
      ...services,
      service: wrap(services.service),
      inferenceService: wrap(services.inferenceService),
      onStep,
    }),
    llm: (services) => ({ ...services, service: wrap(services.service), onStep }),
    throwIfCanceled,
  };
}

/** 舞台 / world 回合只要一份 service：它们的计划与落账都不跑增量推理。 */
function llmServicesOf(services: TurnServices): LlmServices {
  return {
    service: services.service,
    ...(services.logger === undefined ? {} : { logger: services.logger }),
  };
}

// ---------------------------------------------------------------- 入队与读取

export type ActorTurnInput = { actor: string; expectedVersion?: number };
export type PlayerTurnInput = {
  actor: string;
  action: PlayerActionRequest;
  expectedVersion?: number;
};
export type StageTurnInput = { stage: string; expectedVersion?: number };

/** 入队一次 actor 回合；返回作业快照，执行结果由调用方轮询。 */
export async function enqueueActorTurn(
  db: Database,
  gameRef: string,
  input: ActorTurnInput,
): Promise<JobSnapshot> {
  const game = await requireActiveGame(db, gameRef);
  const payload = npcPayload.parse({
    gameId: game.id,
    actorName: input.actor,
    ...versionOf(input.expectedVersion),
  });
  return put(db, TURN_JOB.actorNpc, game.id, payload);
}

/** 入队一个玩家动作；它同样是一个回合，计数由执行端记。 */
export async function enqueuePlayerTurn(
  db: Database,
  gameRef: string,
  input: PlayerTurnInput,
): Promise<JobSnapshot> {
  const game = await requireActiveGame(db, gameRef);
  const payload = playerPayload.parse({
    gameId: game.id,
    actorName: input.actor,
    action: input.action,
    ...versionOf(input.expectedVersion),
  });
  return put(db, TURN_JOB.actorPlayer, game.id, payload);
}

export async function enqueueStageTurn(
  db: Database,
  gameRef: string,
  input: StageTurnInput,
): Promise<JobSnapshot> {
  const game = await requireActiveGame(db, gameRef);
  const payload = stagePayload.parse({
    gameId: game.id,
    stageRef: input.stage,
    ...versionOf(input.expectedVersion),
  });
  return put(db, TURN_JOB.stage, game.id, payload);
}

export async function enqueueWorldTurn(
  db: Database,
  gameRef: string,
  input: { expectedVersion?: number },
): Promise<JobSnapshot> {
  const game = await requireActiveGame(db, gameRef);
  const payload = worldPayload.parse({
    gameId: game.id,
    ...versionOf(input.expectedVersion),
  });
  return put(db, TURN_JOB.world, game.id, payload);
}

/**
 * 一条作业的对外视图：状态、失败原因与结果摘要；不暴露 payload 与租约字段。
 *
 * 时间在这一层就转成 ISO 字符串，与其它投影（行动顺位、事件流）同一口径：
 * 客户端拿到的 JSON 不该出现只在服务端成立的 `Date`。
 */
export type TurnJobView = {
  jobId: string;
  kind: string;
  queue: string;
  status: JobSnapshot["status"];
  serializationKey: string | null;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  errorCode: string | null;
  /** 执行中的阶段：`planning` / `applying` / `finalizing`，没上报过为 null。 */
  progress: JobProgress | null;
  /** 是否已收到取消请求：执行中的作业会在下一个检查点停下。 */
  cancelRequested: boolean;
  runAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  result: TurnJobResult | null;
};

/** 刚入队的作业还没有结果；形状统一成「带 result」的视图，客户端只认一种。 */
export function toJobView(snapshot: JobSnapshot): TurnJobView {
  return {
    jobId: snapshot.jobId,
    kind: snapshot.kind,
    queue: snapshot.queue,
    status: snapshot.status,
    serializationKey: snapshot.serializationKey,
    attempts: snapshot.attempts,
    maxAttempts: snapshot.maxAttempts,
    error: snapshot.error,
    errorCode: snapshot.errorCode,
    progress: snapshot.progress,
    cancelRequested: snapshot.cancelRequested,
    runAt: snapshot.runAt.toISOString(),
    startedAt: snapshot.startedAt === null ? null : snapshot.startedAt.toISOString(),
    finishedAt: snapshot.finishedAt === null ? null : snapshot.finishedAt.toISOString(),
    createdAt: snapshot.createdAt.toISOString(),
    updatedAt: snapshot.updatedAt.toISOString(),
    result: null,
  };
}

/**
 * 列这一局的作业。
 *
 * 默认只列活跃的（`pending` / `running`）：客户端重载后要问的是「现在有没有回合在跑」，
 * 而不是翻历史。带 `updatedSince` 时改为「这一局自那个时刻之后变过的作业」，终态也在内——
 * 流式推送断线重连后就是靠它补上错过的终态。
 */
export type TurnJobListOptions = {
  /** false 时连历史一起列；默认只列活跃的。 */
  activeOnly?: boolean;
  /** 只列更新时间晚于它的作业。 */
  updatedSince?: Date;
  limit?: number;
};

export async function listTurnJobs(
  db: Database,
  gameRef: string,
  options: TurnJobListOptions = {},
): Promise<TurnJobView[]> {
  const game = await getGameMeta(db, gameRef);
  // 一次查询取全（含 result）：列表不该按 id 逐条补一遍。
  const records = await new JobStore(db).listRecords({
    serializationKey: turnSerializationKey(game.id),
    ...(options.updatedSince === undefined && options.activeOnly !== false
      ? { statuses: ACTIVE_JOB_STATUSES }
      : {}),
    ...(options.updatedSince === undefined ? {} : { updatedSince: options.updatedSince }),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  });
  return records
    .filter((record) => isPayloadOf(record.payload, game.id))
    .map((record) => ({
      ...toJobView(record),
      result: (record.result as TurnJobResult | null) ?? null,
    }));
}

export type CancelTurnJobOutcome =
  | { ok: true; outcome: "canceled" | "requested"; job: TurnJobView }
  | { ok: false; reason: "not_found" | "finished" };

/**
 * 取消一个回合：排队中的当场撤成 `canceled`；执行中的只置 `cancelRequested`，
 * 等 worker 在落账开始前停下。已经进写事务的会跑完，以 `succeeded` 收尾。
 */
export async function cancelTurnJob(
  db: Database,
  gameRef: string,
  jobId: string,
): Promise<CancelTurnJobOutcome> {
  const game = await getGameMeta(db, gameRef);
  const store = new JobStore(db);
  const record = await store.getRecord(jobId);
  if (record === null || !isPayloadOf(record.payload, game.id)) {
    return { ok: false, reason: "not_found" };
  }
  const requested = await store.requestCancel(jobId);
  if (requested === null) {
    return { ok: false, reason: "finished" };
  }
  return {
    ok: true,
    outcome: requested.outcome,
    job: { ...toJobView(requested.job), result: null },
  };
}

/** 按 id 读作业；只认属于这一局的那些，别局的 id 一律当不存在。 */
export async function readTurnJob(
  db: Database,
  gameRef: string,
  jobId: string,
): Promise<TurnJobView | null> {
  const game = await getGameMeta(db, gameRef);
  const record = await new JobStore(db).getRecord(jobId);
  if (record === null) {
    return null;
  }
  if (!isPayloadOf(record.payload, game.id)) {
    return null;
  }
  return {
    ...toJobView(record),
    result: (record.result as TurnJobResult | null) ?? null,
  };
}

function isPayloadOf(payload: unknown, gameId: string): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { gameId?: unknown }).gameId === gameId
  );
}

async function requireActiveGame(db: Database, gameRef: string) {
  const game = await getGameMeta(db, gameRef);
  if (game.status !== "active") {
    throw new GameError("invalid_state", `游戏已结束: ${game.status}`);
  }
  return game;
}

/** 序列化并落一行作业；`maxAttempts` 固定 1——回合不自动重试，重试归客户端。 */
async function put(
  db: Database,
  kind: string,
  gameId: string,
  payload: Record<string, unknown>,
): Promise<JobSnapshot> {
  try {
    return await new JobStore(db).enqueue({
      kind,
      payload: toJsonValue(payload, `${kind}.payload`),
      queue: TURN_QUEUE,
      serializationKey: turnSerializationKey(gameId),
      maxAttempts: 1,
    });
  } catch (error) {
    // 串行键被占：这一局已经有回合在跑。对客户端是「稍后再入队」，不是 500。
    if (error instanceof JobSerializationConflictError) {
      throw new GameError(
        "invalid_state",
        `这一局已有回合在跑，等它结束后再入队${error.existingJobId ? `: ${error.existingJobId}` : ""}`,
      );
    }
    throw error;
  }
}

function versionOf(expectedVersion: number | undefined): { expectedVersion?: number } {
  return expectedVersion === undefined ? {} : { expectedVersion };
}
