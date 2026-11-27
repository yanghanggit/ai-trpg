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
  buildDataOp,
  cancelTurnJob,
  compactOp,
  completeActionOrderOp,
  createActionOrderOp,
  createGameOp,
  deleteGameOp,
  endGameOp,
  enqueueActorTurn,
  enqueuePlayerTurn,
  enqueueStageTurn,
  enqueueWorldTurn,
  listGamesOp,
  listPromptBundlesOp,
  listSnapshotsOp,
  listStoriesOp,
  listTurnJobs,
  memoryOp,
  nameLeaksOp,
  passTurn,
  playerActionBodySchema,
  probeOp,
  readActionOrderOp,
  readActorLog,
  readActorView,
  readGameGraph,
  readGameMessages,
  readGameState,
  readPromptBundleOp,
  readSnapshotOp,
  readStageMap,
  readStoryOp,
  readTurnJob,
  readVisitedStages,
  releaseControlOp,
  removeActionOrderOp,
  settleDeaths,
  snapshotOp,
  storyOp,
  takeControlOp,
  toJobView,
} from "../game-ops";
import { HttpError } from "../http-error";
import { isAdmin } from "../identity";
import { type AuthUser, requireUser } from "../plugins/auth";
import { actionOrderSchema } from "./schemas/action-order";
import { actorLogSchema, actorViewSchema, gameMessageSchema } from "./schemas/client-view";
import { gameGraphSchema } from "./schemas/graph";
import { turnJobSchema } from "./schemas/jobs";
import { gameMemorySchema, gameProbeSchema } from "./schemas/memory";

const gameParams = z.object({ game: z.string().trim().min(1) });
const actorParams = gameParams.extend({ actor: z.string().trim().min(1) });
const actionOrderParams = gameParams.extend({ order: z.string().trim().min(1) });
const jobParams = gameParams.extend({ job: z.string().trim().min(1) });
const snapshotParams = gameParams.extend({ snapshot: z.string().trim().min(1) });
const promptBundleParams = gameParams.extend({ bundle: z.string().trim().min(1) });
const storyParams = gameParams.extend({ story: z.string().trim().min(1) });
const jobsQuery = z.object({
  /** 默认只列活跃作业；`all` 连历史一起列（排查用）。 */
  status: z.enum(["active", "all"]).optional(),
  /** 只要更新时间晚于这个时刻的作业；断线重连补查用。 */
  updatedSince: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/** 活状态是内部投影，暂不在这里收窄；契约稳定后再补字段级 schema。 */
const stateSchema = z.unknown();
const resultsSchema = z.array(z.record(z.string(), z.unknown()));

const actorTurnResponse = z.record(z.string(), z.unknown());

/** 局列表一行：够回答「有哪些局、跑到哪、现在有没有运行中的作业」。 */
const gameSummarySchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    ownerId: z.string(),
    ownerUsername: z.string(),
    worldName: z.string().nullable(),
    name: z.string(),
    status: z.string(),
    outcome: z.string().nullable(),
    contentVersion: z.string(),
    version: z.number(),
    clock: z.number(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "GameSummary" });

/** 建局数据：集合的形状固定，行是原始列，值不收窄。 */
const buildRowSchema = z.record(z.string(), z.unknown());
const gameBuildSchema = z
  .object({
    game: buildRowSchema.nullable(),
    world: buildRowSchema.nullable(),
    stages: z.array(buildRowSchema),
    stageConnections: z.array(buildRowSchema),
    actors: z.array(buildRowSchema),
    actorSignatures: z.array(buildRowSchema),
    actorSignatureNames: z.array(buildRowSchema),
    items: z.array(buildRowSchema),
    stageItems: z.array(buildRowSchema),
    gamePlayers: z.array(buildRowSchema),
  })
  .meta({ id: "GameBuild" });

const listGamesQuery = z.object({
  status: z.enum(["active", "completed"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

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

/**
 * 一条请求入队一个回合：一个 actor、一个舞台、一个 world。
 *
 * `expectedVersion` 是客户端读到的那份视图的版本，执行开始时才比对——入队到开跑之间
 * 世界可能已经被别的回合改过。
 */
const turnVersionBody = {
  expectedVersion: z.number().int().min(0).optional(),
};

const npcTurnBody = z.object({
  actor: z.string().trim().min(1, "需要 actor 名"),
  ...turnVersionBody,
});

/** 空回合：在顺位上记一笔「轮到过他」，不产生动作。 */
const passTurnBody = z.object({
  actors: z.array(z.string().trim().min(1)).min(1, "需要至少一个 actor 名"),
});

const stageTurnBody = z.object({
  stage: z.string().trim().min(1, "需要 stageId 或 stageName"),
  ...turnVersionBody,
});

/** 玩家动作的入队形状：动作本身仍是那份 discriminated union，只是外面多一层。 */
const playerTurnBody = z.object({
  action: playerActionBodySchema,
  ...turnVersionBody,
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

const snapshotEntrySchema = z
  .object({
    snapshotId: z.string(),
    createdAt: z.iso.datetime(),
    action: z.string().nullable(),
    dbVersion: z.number().nullable(),
    contentVersion: z.string().nullable(),
    parts: z.number(),
    path: z.string(),
  })
  .meta({ id: "GameSnapshotEntry" });

const storyEntrySchema = z
  .object({
    name: z.string(),
    createdAt: z.string(),
    title: z.string(),
    version: z.number().nullable(),
    rounds: z.number().nullable(),
    path: z.string(),
  })
  .meta({ id: "GameStoryEntry" });

const promptBundleEntrySchema = z
  .object({
    id: z.string(),
    createdAt: z.iso.datetime(),
    world: z.string(),
    contentVersion: z.string(),
    bytes: z.number(),
    counts: z.object({
      world: z.number(),
      functions: z.number(),
      stages: z.number(),
      actors: z.number(),
    }),
    path: z.string(),
  })
  .meta({ id: "GamePromptBundle" });

const promptBundleFileSchema = z
  .object({
    kind: z.enum(["world", "function", "stage", "actor"]),
    name: z.string(),
    path: z.string(),
    bytes: z.number(),
    content: z.string(),
  })
  .meta({ id: "GamePromptFile" });

const promptBundleSchema = z
  .object({
    id: z.string(),
    createdAt: z.iso.datetime(),
    world: z.string(),
    contentVersion: z.string(),
    path: z.string(),
    files: z.array(promptBundleFileSchema),
  })
  .meta({ id: "GamePromptBundleContent" });

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
export async function requireGameAccess(
  db: Database,
  gameRef: string,
  user: AuthUser,
): Promise<void> {
  const game = await findGame(db, gameRef);
  if (!game) {
    throw new HttpError(404, "not_found", `游戏不存在: ${gameRef}`);
  }
  // 运维名单越过 owner 检查：它不拥有局，却能读任意一局。判定只在这一处。
  if (isAdmin(user.username)) {
    return;
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
          description: "开发期的「我是谁」：只有两行用户与一张写死的运维名单，没有角色字段。",
          response: {
            200: z.object({
              user: z.object({
                id: z.string(),
                username: z.string(),
                displayName: z.string(),
                /** 是否在运维名单里：决定能看全库还是只看自己名下的局。 */
                isAdmin: z.boolean(),
              }),
            }),
          },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        return { user: { ...user, isAdmin: isAdmin(user.username) } };
      },
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

    // 建局数据：一次性写下的那批行，运行时状态不在这里。
    app.get(
      "/games/:game/build",
      {
        schema: {
          tags: ["games"],
          summary: "建局物化的原始数据",
          description:
            "world / stage / 通路 / actor / 形态 / 道具 / 玩家归属的原始行，不做字段挑选。" +
            "运行时状态（clock、version、消息、记忆、作业）不在这里。",
          params: gameParams,
          response: { 200: gameBuildSchema },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        return buildDataOp(db(), request.params.game);
      },
    );

    // 控制面的局列表：写的是「这一局跑到哪」，不是世界内容。
    app.get(
      "/games",
      {
        schema: {
          tags: ["games"],
          summary: "列出局（运维看全库，其他人只看自己名下）",
          description:
            "按更新时间倒序。运维身份看全库，其他人只看自己名下的局——可见性只由身份决定，" +
            "所以这里没有 owner 参数。这一局此刻在跑什么作业，看 `GET /games/{game}/jobs`。",
          querystring: listGamesQuery,
          response: { 200: z.object({ games: z.array(gameSummarySchema) }) },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        return listGamesOp(db(), user, request.query);
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

    // 图谱（上帝视角、带名字）：控制台画「世界 → 舞台 → actor → 道具」的实体索引。
    app.get(
      "/games/:game/graph",
      {
        schema: {
          tags: ["games"],
          summary: "上帝视角的实体索引：舞台图、actor 与当前顺位",
          description:
            "舞台与 actor 摊平成两张表，靠 `stageId` 相连；顺位是另一张快照，没有进行中的就是 `null`。" +
            "不带公共事件流与世界级提示词——它随长局无界增长，不该混进一屏能读完的图谱。" +
            "叶子实体（道具、装备、属性）原样透传。",
          params: gameParams,
          response: { 200: gameGraphSchema },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        return readGameGraph(db(), request.params.game);
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

    app.get(
      "/games/:game/snapshots",
      {
        schema: {
          tags: ["games"],
          summary: "列出这一局的快照（磁盘上的文件，不是库里的行）",
          description:
            "按生成时间倒序。快照是提交后的只读投影，放在 `logs/worlds/<user>/<game>/<id>/`；" +
            "库是权威状态源，这里只读文件。",
          params: gameParams,
          response: {
            200: z.object({ dir: z.string(), snapshots: z.array(snapshotEntrySchema) }),
          },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        return listSnapshotsOp(db(), request.params.game);
      },
    );

    app.get(
      "/games/:game/snapshots/:snapshot",
      {
        schema: {
          tags: ["games"],
          summary: "读一份快照：清单，或清单里某一份的原文",
          description:
            "不带 `part` 只回 manifest；带 `part` 回那一份的原文（名字必须出现在 manifest.parts 里）。",
          params: snapshotParams,
          querystring: z.object({ part: z.string().trim().min(1).optional() }),
          response: {
            200: z.object({
              manifest: z.record(z.string(), z.unknown()),
              part: z.string().nullable(),
              content: z.string().nullable(),
            }),
          },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        return readSnapshotOp(
          db(),
          request.params.game,
          request.params.snapshot,
          request.query.part,
        );
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

    app.get(
      "/games/:game/stories",
      {
        schema: {
          tags: ["games"],
          summary: "列出这一局的故事总结（磁盘上的 .md）",
          description: "目录是平的，靠文件头里的 `- slug:` 认领；按生成时间倒序。",
          params: gameParams,
          response: {
            200: z.object({ dir: z.string(), stories: z.array(storyEntrySchema) }),
          },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        return listStoriesOp(db(), request.params.game);
      },
    );

    app.get(
      "/games/:game/stories/:story",
      {
        schema: {
          tags: ["games"],
          summary: "读一份故事总结的原文",
          params: storyParams,
          response: {
            200: z.object({ name: z.string(), path: z.string(), content: z.string() }),
          },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        return readStoryOp(db(), request.params.game, request.params.story);
      },
    );

    app.get(
      "/games/:game/prompts",
      {
        schema: {
          tags: ["games"],
          summary: "列出这一局建局时导出的 system prompt（磁盘上的目录，不是库里的行）",
          description:
            "一次建局导出一次，放在 `logs/prompts/<时间>_<世界名>_<内容版本>/`；" +
            "容器里的 `manifest.json` 记着是哪一局建的，这里按它认领。新的在前。",
          params: gameParams,
          response: {
            200: z.object({ dir: z.string(), bundles: z.array(promptBundleEntrySchema) }),
          },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        return listPromptBundlesOp(db(), request.params.game);
      },
    );

    app.get(
      "/games/:game/prompts/:bundle",
      {
        schema: {
          tags: ["games"],
          summary: "读一份导出的 system prompt 原文（world / functions / stages / actors）",
          description:
            "一次读回这一份的全部文件：提示词不随回合变，逐份再请求没有意义。" +
            "文件清单来自 `manifest.json`，不拼任意路径。",
          params: promptBundleParams,
          response: { 200: promptBundleSchema },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        return readPromptBundleOp(db(), request.params.game, request.params.bundle);
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
          summary: "入队一个玩家动作：一次提交就是一个回合",
          description:
            "动作本身就是回合：入队后立刻返回作业，落账与计数在作业里完成。" +
            "一个 `kind` 对应 `agent-game` 的一个 `player-*` 子命令。",
          params: actorParams,
          body: playerTurnBody,
          response: { 202: z.object({ job: turnJobSchema }) },
        },
      },
      async (request, reply) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        const job = await enqueuePlayerTurn(db(), request.params.game, {
          actor: request.params.actor,
          action: request.body.action,
          ...(request.body.expectedVersion === undefined
            ? {}
            : { expectedVersion: request.body.expectedVersion }),
        });
        return reply.code(202).send({ job: toJobView(job) });
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
          summary: "入队一个 NPC 回合：立刻返回作业，执行在请求之外",
          description: "同一个 actor 一次一个回合；结果与计数以作业终态为准。",
          params: gameParams,
          body: npcTurnBody,
          response: { 202: z.object({ job: turnJobSchema }) },
        },
      },
      async (request, reply) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        const job = await enqueueActorTurn(db(), request.params.game, request.body);
        return reply.code(202).send({ job: toJobView(job) });
      },
    );

    app.post(
      "/games/:game/turns/pass",
      {
        schema: {
          tags: ["turns"],
          summary: "记空回合：计数照加，不产生动作",
          description: "跳过失败的一轮、或玩家席位这一趟没动手。",
          params: gameParams,
          body: passTurnBody,
          response: { 200: z.object({ results: resultsSchema }) },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        return passTurn(db(), request.params.game, request.body);
      },
    );

    app.post(
      "/games/:game/turns/stage",
      {
        schema: {
          tags: ["turns"],
          summary: "入队一个舞台回合：立刻返回作业，执行在请求之外",
          params: gameParams,
          body: stageTurnBody,
          response: { 202: z.object({ job: turnJobSchema }) },
        },
      },
      async (request, reply) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        const job = await enqueueStageTurn(db(), request.params.game, request.body);
        return reply.code(202).send({ job: toJobView(job) });
      },
    );

    app.post(
      "/games/:game/turns/world",
      {
        schema: {
          tags: ["turns"],
          summary: "入队一个 world 回合：立刻返回作业，执行在请求之外",
          params: gameParams,
          body: z.object(turnVersionBody),
          response: { 202: z.object({ job: turnJobSchema }) },
        },
      },
      async (request, reply) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        const job = await enqueueWorldTurn(db(), request.params.game, request.body);
        return reply.code(202).send({ job: toJobView(job) });
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

    // ------------------------------------------------------------ 作业

    app.get(
      "/games/:game/jobs",
      {
        schema: {
          tags: ["jobs"],
          summary: "列这一局的作业",
          description:
            "默认只列活跃作业（排队或执行中），用于「现在有没有作业在跑」与重载后重接；" +
            "带 updatedSince 时改为列自那之后变过的作业，终态也在内，供断线重连补查。",
          params: gameParams,
          querystring: jobsQuery,
          response: { 200: z.object({ jobs: z.array(turnJobSchema) }) },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        const { status, updatedSince, limit } = request.query;
        const jobs = await listTurnJobs(db(), request.params.game, {
          ...(status === "all" ? { activeOnly: false } : {}),
          ...(updatedSince === undefined ? {} : { updatedSince: new Date(updatedSince) }),
          ...(limit === undefined ? {} : { limit }),
        });
        return { jobs };
      },
    );

    app.post(
      "/games/:game/jobs/:job/cancel",
      {
        schema: {
          tags: ["jobs"],
          summary: "取消一个回合（排队中立即撤，执行中在检查点停）",
          description:
            "排队中的当场撤成 canceled，串行键释放；执行中的置 cancelRequested，worker 一秒内看到、" +
            "在落账开始前的检查点停下（正在等的模型调用会被真正中断）。已经开跑落账的那一回合会跑完，" +
            "以 succeeded 结束。已到终态的作业回 409——那不是错误，只是没什么可撤的。",
          params: jobParams,
          response: {
            200: z.object({ outcome: z.enum(["canceled", "requested"]), job: turnJobSchema }),
          },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        const outcome = await cancelTurnJob(db(), request.params.game, request.params.job);
        if (!outcome.ok) {
          throw outcome.reason === "not_found"
            ? new HttpError(404, "not_found", `作业不存在: ${request.params.job}`)
            : new HttpError(
                409,
                "invalid_state",
                `这一回合已经结束，没有可撤的: ${request.params.job}`,
              );
        }
        return { outcome: outcome.outcome, job: outcome.job };
      },
    );

    app.get(
      "/games/:game/jobs/:job",
      {
        schema: {
          tags: ["jobs"],
          summary: "读一条回合作业的状态与结果",
          description: "作业只对本局可见；别局的 id 一律当不存在。",
          params: jobParams,
          response: { 200: z.object({ job: turnJobSchema }) },
        },
      },
      async (request) => {
        const user = await requireUser(db(), request);
        await requireGameAccess(db(), request.params.game, user);
        const job = await readTurnJob(db(), request.params.game, request.params.job);
        if (job === null) {
          throw new HttpError(404, "not_found", `作业不存在: ${request.params.job}`);
        }
        return { job };
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
          response: { 200: gameProbeSchema },
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
          response: { 200: gameMemorySchema },
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
