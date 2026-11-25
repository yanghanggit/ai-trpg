/**
 * 开发期业务 API：一局的状态、接管、玩家动作、回合推进与排查。
 *
 * 这一层只做三件事：解析参数、校验身份、把调用交给 `game-ops`。
 * 输出与 `agent-game` 的命令信封一致，`agent:api` 因此可以逐命令对照。
 *
 * 开发期身份用 `Authorization: Bearer <username>`（见 `plugins/auth.ts`）；
 * 路由不缓存世界状态，每次写入都基于数据库当前状态。
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { CONTENT_PACKS, getContentPack } from "../../seeds";
import type { Database } from "../db/pool";
import { DEEPSEEK_SERVICE } from "../deepseek";
import { findGame } from "../game/persistence/games";
import { parseWorldContent } from "../game/world-definition";
import {
  advanceAppearance,
  advanceNpc,
  advanceStage,
  advanceWorld,
  compactOp,
  completeActionOrderOp,
  createActionOrderOp,
  createGameOp,
  deleteGameOp,
  endGameOp,
  memoryOp,
  nameLeaksOp,
  playerActionBodySchema,
  probeOp,
  readActionOrderOp,
  readActorLog,
  readActorView,
  readGameMessages,
  readGameState,
  readStageMap,
  readVisitedStages,
  releaseControlOp,
  removeActionOrderOp,
  settleDeaths,
  snapshotOp,
  storyOp,
  submitPlayerAction,
  takeControlOp,
} from "../game-ops";
import { HttpError } from "../http-error";
import { type AuthUser, requireUser } from "../plugins/auth";
import { actionOrderSchema } from "./schemas/action-order";
import { actorLogSchema, actorViewSchema, gameMessageSchema } from "./schemas/client-view";

const gameParams = z.object({ game: z.string().trim().min(1) });
const actorParams = gameParams.extend({ actor: z.string().trim().min(1) });
const actionOrderParams = gameParams.extend({ order: z.string().trim().min(1) });

/** 活状态是内部投影，暂不在这里收窄；契约稳定后再补字段级 schema。 */
const stateSchema = z.unknown();
const resultsSchema = z.array(z.record(z.string(), z.unknown()));

const stageTurnEnvelope = {
  ok: z.boolean(),
  plan: z.unknown(),
  loopSuccess: z.boolean(),
  state: stateSchema,
  messageCursor: z.number(),
};

const actorTurnResponse = z.record(z.string(), z.unknown());

const createBody = z.object({
  seed: z.string().trim().min(1).optional(),
  world: z.unknown().optional(),
  name: z.string().trim().min(1).optional(),
  slug: z.string().trim().min(1).optional(),
});

const endGameBody = z.object({
  outcome: z.string().trim().min(1, "需要结局标签"),
  /** 可选的结束正文；不给就只翻状态，不写公共事件。 */
  message: z.string().optional(),
});

/** 回合推进只吃显式名单，没有「全部」：想推一群就把名字都列出来。 */
const npcTurnBody = z.object({
  actors: z.array(z.string().trim().min(1)).min(1, "需要至少一个 actor 名"),
  /** 客户端读到的那份视图的版本；给了就要求一致，避免拿旧视图做决定。 */
  expectedVersion: z.number().int().min(0).optional(),
});

const stageTurnBody = z.object({
  stages: z.array(z.string().trim().min(1)).min(1, "需要至少一个 stageId 或 stageName"),
});

const appearanceTurnBody = z.object({
  actors: z.array(z.string().trim().min(1)).min(1, "需要至少一个 actor 名"),
});

const probeBody = z.object({
  actor: z.string().trim().min(1).optional(),
  stage: z.string().trim().min(1).optional(),
  message: z.string().trim().min(1, "需要 message"),
});

const memoryQuery = z.object({
  owner: z.enum(["actor", "stage", "world"]),
  name: z.string().trim().min(1).optional(),
});

const nameLeakQuery = z.object({
  scope: z.enum(["ever", "current"]).optional(),
  allow: z.string().optional(),
  includeSystem: z.boolean().optional(),
  since: z.string().trim().min(1).optional(),
});

const compactBody = z.object({
  owner: z.enum(["actor", "stage", "world", "all"]),
  name: z.string().trim().min(1).optional(),
  minRatio: z.number().min(0).max(1).optional(),
});

const snapshotBody = z.object({ root: z.string().trim().min(1).optional() });

/** 开发期没有 AC；同一局的写入靠事务里的行锁串行化。 */
function services() {
  return { service: DEEPSEEK_SERVICE, inferenceService: DEEPSEEK_SERVICE };
}

/**
 * 定位一局并要求调用者是局主。
 *
 * slug 只按 owner 唯一，`findGame` 在跨用户重名时会失败——那是正确行为，
 * 客户端应改用 id。
 */
async function requireGameAccess(db: Database, gameRef: string, user: AuthUser): Promise<void> {
  const game = await findGame(db, gameRef);
  if (!game) {
    throw new HttpError(404, "not_found", `游戏不存在: ${gameRef}`);
  }
  if (game.ownerId !== user.id) {
    throw new HttpError(403, "forbidden", "无权访问该局");
  }
}

function parseSplitNames(raw: string | undefined): string[] {
  if (raw === undefined) {
    return [];
  }
  return raw
    .split(/[,，\s]+/)
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

/** 路由只拿一个数据库访问器：连接池由进程入口持有，测试与环境工具可以换成桩。 */
export function createGameRoutes(db: () => Database): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      "/me",
      {
        schema: {
          tags: ["account"],
          summary: "当前身份",
          response: {
            200: z.object({
              user: z.object({
                id: z.string(),
                username: z.string(),
                displayName: z.string(),
              }),
            }),
          },
        },
      },
      async (request) => ({ user: await requireUser(db(), request) }),
    );

    // ------------------------------------------------------------ 建局与读取

    app.post(
      "/games",
      {
        schema: {
          tags: ["games"],
          summary: "建一局",
          description: "内容来源二选一：内置种子名，或内联 world JSON。",
          body: createBody,
          response: { 200: z.object({ view: actorViewSchema }) },
        },
      },
      async (request) => {
        const body = request.body;
        const user = await requireUser(db(), request);
        if ((body.seed === undefined) === (body.world === undefined)) {
          throw new HttpError(400, "invalid_request", "seed 与 world 必须二选一");
        }
        const world =
          body.seed !== undefined
            ? parseWorldContent(getContentPack(body.seed).world)
            : parseWorldContent(body.world);
        const created = await createGameOp(
          db(),
          {
            username: user.username,
            world,
            ...(body.name === undefined ? {} : { name: body.name }),
            ...(body.slug === undefined ? {} : { slug: body.slug }),
          },
          { logger: request.log },
        );
        return readActorView(db(), created.state.game.slug);
      },
    );

    app.get(
      "/games/content-packs",
      {
        schema: {
          tags: ["games"],
          summary: "可用的内置内容包",
          response: { 200: z.object({ packs: z.array(z.string()) }) },
        },
      },
      async (request) => {
        await requireUser(db(), request);
        return { packs: Object.keys(CONTENT_PACKS) };
      },
    );

    /**
     * 结束一局：与 world 回合的结束同一个转移点，只多一个「谁叫停的」的区分。
     *
     * 已结束的局再结束返回 `ended: false`，不是错误——客户端重试不该看到失败。
     */
    app.post(
      "/games/:game/end",
      {
        schema: {
          tags: ["games"],
          summary: "结束一局（客户端叫停，与 world 裁决同一转移点）",
          description: "结局标签归调用方；正文可选，不给就只翻状态、不写事件。",
          params: gameParams,
          body: endGameBody,
          response: { 200: z.object({ ended: z.boolean() }) },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        return endGameOp(db(), request.params.game, request.body);
      },
    );

    /** 删局：一行级联清场，不留归档；轨迹文件是旁路，不跟着删。 */
    app.delete(
      "/games/:game",
      {
        schema: {
          tags: ["games"],
          summary: "删除一局（级联清场，不可恢复）",
          params: gameParams,
          response: { 200: z.object({ deleted: z.string(), slug: z.string() }) },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        return deleteGameOp(db(), request.params.game);
      },
    );

    app.get(
      "/games/:game",
      {
        schema: {
          tags: ["games"],
          summary: "读取一局的观看者投影",
          description:
            "客户端读模型：默认取玩家操控的角色，`actor` 可指定别的观看者。查询参数是开发期接口，正式客户端不带它。",
          params: gameParams,
          querystring: z.object({ actor: z.string().trim().min(1).optional() }),
          response: { 200: z.object({ view: actorViewSchema }) },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        return readActorView(db(), request.params.game, request.query.actor);
      },
    );

    // 感知日志：角色经历过的事，来自他自己的记忆。客户端暂不展示，端点先留着。
    app.get(
      "/games/:game/log",
      {
        schema: {
          tags: ["games"],
          summary: "读取某个观看者的感知日志",
          description:
            "从该角色的记忆里挑出他真正收到的几类，按发生顺序。客户端暂不展示：它是回看用的，不是主页要的。",
          params: gameParams,
          querystring: z.object({ actor: z.string().trim().min(1).optional() }),
          response: { 200: z.object({ log: actorLogSchema }) },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        return readActorLog(db(), request.params.game, request.query.actor);
      },
    );

    // 控制面投影（上帝视角、带名字）：agent:api 与排查用，不是客户端契约。
    app.get(
      "/games/:game/state",
      {
        schema: {
          tags: ["games"],
          summary: "读取一局的完整状态",
          description: "上帝视角的活状态；客户端用 `/games/{game}` 的观看者投影。",
          params: gameParams,
          response: { 200: z.object({ state: stateSchema }) },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        return readGameState(db(), request.params.game);
      },
    );

    app.get(
      "/games/:game/messages",
      {
        schema: {
          tags: ["games"],
          summary: "按序号增量读公共事件流",
          params: gameParams,
          querystring: z.object({
            after: z.coerce.number().int().min(0).optional(),
            limit: z.coerce.number().int().min(1).optional(),
          }),
          response: {
            200: z.object({
              messages: z.array(gameMessageSchema),
              messageCursor: z.number(),
            }),
          },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        return readGameMessages(db(), request.params.game, request.query);
      },
    );

    app.get(
      "/games/:game/stage-map",
      {
        schema: {
          tags: ["games"],
          summary: "按舞台列出 actor 名字",
          params: gameParams,
          response: { 200: z.object({ stages: z.record(z.string(), z.array(z.string())) }) },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        return readStageMap(db(), request.params.game);
      },
    );

    app.post(
      "/games/:game/snapshot",
      {
        schema: {
          tags: ["games"],
          summary: "把当前局落成文件快照",
          params: gameParams,
          body: snapshotBody,
          response: {
            200: z.object({
              path: z.string(),
              manifest: z.record(z.string(), z.unknown()),
              game: z.record(z.string(), z.unknown()),
            }),
          },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        return snapshotOp(db(), request.params.game, request.body);
      },
    );

    app.post(
      "/games/:game/story",
      {
        schema: {
          tags: ["games"],
          summary: "跑一次故事总结并落盘",
          params: gameParams,
          response: { 200: actorTurnResponse },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        return storyOp(db(), request.params.game, services());
      },
    );

    // ------------------------------------------------------------ 接管与玩家动作

    app.post(
      "/games/:game/actors/:actor/control",
      {
        schema: {
          tags: ["actions"],
          summary: "把 actor 标记为玩家接管",
          params: actorParams,
          response: { 200: actorTurnResponse },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        return takeControlOp(db(), request.params.game, request.params.actor);
      },
    );

    app.delete(
      "/games/:game/actors/:actor/control",
      {
        schema: {
          tags: ["actions"],
          summary: "解除玩家接管",
          params: actorParams,
          response: { 200: actorTurnResponse },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        return releaseControlOp(db(), request.params.game, request.params.actor);
      },
    );

    app.post(
      "/games/:game/actors/:actor/actions",
      {
        schema: {
          tags: ["actions"],
          summary: "提交一个玩家动作",
          description: "一个 `kind` 对应 `agent-game` 的一个 `player-*` 子命令。",
          params: actorParams,
          body: playerActionBodySchema,
          response: {
            200: z.object({
              plan: z.unknown(),
              state: stateSchema,
              death: z.unknown().optional(),
            }),
          },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        return submitPlayerAction(
          db(),
          request.params.game,
          request.params.actor,
          request.body,
          services(),
        );
      },
    );

    app.get(
      "/games/:game/actors/:actor/visited-stages",
      {
        schema: {
          tags: ["actions"],
          summary: "列出 actor 去过的舞台",
          params: actorParams,
          response: {
            200: z.object({
              actor: z.object({ id: z.string(), name: z.string() }),
              visited: z.array(z.object({ stageId: z.string(), name: z.string() })),
            }),
          },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        return readVisitedStages(db(), request.params.game, request.params.actor);
      },
    );

    // ------------------------------------------------------------ 回合推进

    app.post(
      "/games/:game/turns/npc",
      {
        schema: {
          tags: ["turns"],
          summary: "按给定名单逐个推进 NPC 回合",
          params: gameParams,
          body: npcTurnBody,
          response: { 200: z.object({ results: resultsSchema }) },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        return advanceNpc(db(), request.params.game, request.body, {
          ...services(),
          logger: request.log,
        });
      },
    );

    app.post(
      "/games/:game/turns/stage",
      {
        schema: {
          tags: ["turns"],
          summary: "按给定名单逐个推进舞台回合",
          params: gameParams,
          body: stageTurnBody,
          response: { 200: z.object({ results: resultsSchema }) },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        return advanceStage(db(), request.params.game, request.body, {
          ...services(),
          logger: request.log,
        });
      },
    );

    app.post(
      "/games/:game/turns/world",
      {
        schema: {
          tags: ["turns"],
          summary: "推进 world 回合",
          params: gameParams,
          response: { 200: z.object(stageTurnEnvelope) },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        return advanceWorld(db(), request.params.game, {
          ...services(),
          logger: request.log,
        });
      },
    );

    app.post(
      "/games/:game/turns/appearance",
      {
        schema: {
          tags: ["turns"],
          summary: "按给定名单逐个重推外观",
          params: gameParams,
          body: appearanceTurnBody,
          response: { 200: z.object({ results: resultsSchema }) },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        return advanceAppearance(db(), request.params.game, request.body, {
          ...services(),
          logger: request.log,
        });
      },
    );

    app.post(
      "/games/:game/turns/deaths",
      {
        schema: {
          tags: ["turns"],
          summary: "对每个未收尾的死者跑一次死亡阶段",
          params: gameParams,
          response: { 200: z.object({ deaths: z.array(z.unknown()) }) },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        return settleDeaths(db(), request.params.game, { ...services(), logger: request.log });
      },
    );

    // ------------------------------------------------------------ 行动顺位

    app.post(
      "/games/:game/action-orders",
      {
        schema: {
          tags: ["action-orders"],
          summary: "开一条行动顺位（按敏捷排序的快照）",
          params: gameParams,
          response: { 200: z.object({ order: actionOrderSchema }) },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        return createActionOrderOp(db(), request.params.game);
      },
    );

    app.get(
      "/games/:game/action-orders/current",
      {
        schema: {
          tags: ["action-orders"],
          summary: "读当前进行中的行动顺位",
          params: gameParams,
          response: { 200: z.object({ order: actionOrderSchema.nullable() }) },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        return readActionOrderOp(db(), request.params.game);
      },
    );

    app.get(
      "/games/:game/action-orders/:order",
      {
        schema: {
          tags: ["action-orders"],
          summary: "按 id 读一条行动顺位（含已完成的）",
          params: actionOrderParams,
          response: { 200: z.object({ order: actionOrderSchema.nullable() }) },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        return readActionOrderOp(db(), request.params.game, request.params.order);
      },
    );

    app.post(
      "/games/:game/action-orders/:order/complete",
      {
        schema: {
          tags: ["action-orders"],
          summary: "完成一条行动顺位",
          params: actionOrderParams,
          response: { 200: z.object({ order: actionOrderSchema }) },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        return completeActionOrderOp(db(), request.params.game, request.params.order);
      },
    );

    app.delete(
      "/games/:game/action-orders/:order",
      {
        schema: {
          tags: ["action-orders"],
          summary: "移除一条行动顺位",
          params: actionOrderParams,
          response: { 200: z.object({ removed: z.string() }) },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        return removeActionOrderOp(db(), request.params.game, request.params.order);
      },
    );

    // ------------------------------------------------------------ 排查与维护

    app.post(
      "/games/:game/probe",
      {
        schema: {
          tags: ["inspect"],
          summary: "只读探针：让 agent 只凭 prompt 与 memory 回答一个问题",
          params: gameParams,
          body: probeBody,
          response: { 200: actorTurnResponse },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        const body = request.body;
        if ((body.actor === undefined) === (body.stage === undefined)) {
          throw new HttpError(400, "invalid_request", "actor 与 stage 必须二选一");
        }
        const target =
          body.actor !== undefined
            ? ({ type: "actor", actorRef: body.actor } as const)
            : ({ type: "stage", stageRef: body.stage as string } as const);
        return probeOp(
          db(),
          request.params.game,
          { message: body.message, target },
          { service: DEEPSEEK_SERVICE },
        );
      },
    );

    app.get(
      "/games/:game/memory",
      {
        schema: {
          tags: ["inspect"],
          summary: "读取某个 agent 的 memory",
          params: gameParams,
          querystring: memoryQuery,
          response: { 200: actorTurnResponse },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        const query = request.query;
        if (query.owner !== "world" && query.name === undefined) {
          throw new HttpError(400, "invalid_request", "actor / stage 还需要 name");
        }
        const memory =
          query.owner === "world"
            ? ({ owner: "world" } as const)
            : ({ owner: query.owner, name: query.name as string } as const);
        return memoryOp(db(), request.params.game, memory);
      },
    );

    app.get(
      "/games/:game/name-leaks",
      {
        schema: {
          tags: ["inspect"],
          summary: "只读扫描 actor 记忆里的真名泄漏",
          params: gameParams,
          querystring: nameLeakQuery,
          response: { 200: actorTurnResponse },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        const query = request.query;
        const since = query.since === undefined ? undefined : new Date(query.since);
        if (since !== undefined && Number.isNaN(since.getTime())) {
          throw new HttpError(400, "invalid_request", "since 需要合法的日期或时间");
        }
        return nameLeaksOp(db(), request.params.game, {
          ...(query.scope === undefined ? {} : { scope: query.scope }),
          ...(query.includeSystem === undefined ? {} : { includeSystem: query.includeSystem }),
          ...(since === undefined ? {} : { since }),
          allow: parseSplitNames(query.allow),
        });
      },
    );

    app.post(
      "/games/:game/compact",
      {
        schema: {
          tags: ["inspect"],
          summary: "压缩某个 / 全部 agent 的 memory",
          params: gameParams,
          body: compactBody,
          response: { 200: z.object({ results: z.array(z.unknown()) }) },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        const body = request.body;
        if ((body.owner === "actor" || body.owner === "stage") && body.name === undefined) {
          throw new HttpError(400, "invalid_request", "actor / stage 还需要 name");
        }
        return compactOp(db(), request.params.game, body as Parameters<typeof compactOp>[2], {
          service: DEEPSEEK_SERVICE,
        });
      },
    );
  };
}
