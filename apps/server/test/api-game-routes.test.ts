/**
 * 业务 API 的骨架守卫：身份、建局、接管、提交动作与事件流。
 *
 * 只覆盖传输层：参数形状、错误码与「动作真的落了事件」。玩法结果由 `game` 的用例负责。
 * 需要 TEST_DATABASE_URL；未配置时整组跳过。
 */

import { randomUUID } from "node:crypto";
import { DEFAULT_SERVER_PORT } from "@ai-trpg/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/db/env";
import { buildApp } from "../src/app";
import type { DatabaseHandle } from "../src/db/connect";
import { openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import { games, users } from "../src/db/schema";
import type { Env } from "../src/env";
import { createTurnJobRegistry, TURN_QUEUE } from "../src/game-ops";
import { ADMIN_USER, DEMO_USER } from "../src/identity";
import { JobStore, JobWorker } from "../src/jobs";
import type { ChatCompletionResult, ChatCompletionService } from "../src/llm";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const SLUG = `api-test-${Date.now()}`;

const testEnv: Env = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: DEFAULT_SERVER_PORT,
  CORS_ORIGINS: "*",
  LOG_LEVEL: "silent",
};

/** wait 不需要模型：被调用就说明链路漏跑了推理。 */
const unusedService: ChatCompletionService = {
  async complete(): Promise<ChatCompletionResult> {
    throw new Error("这条用例不该调用模型");
  },
};

describe.skipIf(!testDatabaseUrl)("业务 API", () => {
  let handle: DatabaseHandle;
  let app: Awaited<ReturnType<typeof buildApp>>;

  const auth = { authorization: `Bearer ${DEMO_USER.username}` };
  const adminAuth = { authorization: `Bearer ${ADMIN_USER.username}` };

  beforeAll(async () => {
    handle = openDatabase("TEST_DATABASE_URL");
    await runMigrations(handle.db);
    await resetDomainData(handle.db);
    await seedDemoData(handle.db);
    app = await buildApp({ env: testEnv, logger: false, db: () => handle.db });
  });

  afterAll(async () => {
    if (handle) {
      for (const slug of [SLUG, `${SLUG}-list`]) {
        await handle.db.delete(games).where(eq(games.slug, slug));
      }
      await handle.pool.end();
    }
    if (app) {
      await app.close();
    }
  });

  it("缺少令牌返回 401", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/me" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: "unauthorized" });
  });

  it("未知用户返回 401", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { authorization: "Bearer nobody" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("令牌解析出身份", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/me", headers: auth });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      user: { username: DEMO_USER.username, isAdmin: false },
    });
  });

  it("建局、读状态、接管、提交动作、读事件流", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/games",
      headers: auth,
      payload: { seed: "dark-fantasy:crow-grave", slug: SLUG },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({
      view: { game: { slug: SLUG, version: 0 }, viewer: { name: "拾骨人伊莱" } },
    });

    // 客户端入口：观看者投影。
    const view = await app.inject({
      method: "GET",
      url: `/api/v1/games/${SLUG}`,
      headers: auth,
    });
    expect(view.statusCode).toBe(200);
    expect(view.json()).toMatchObject({
      view: {
        game: { slug: SLUG },
        viewer: { name: "拾骨人伊莱", concealed: false },
        stage: { name: "鸦葬岗", actors: expect.any(Array), anchors: expect.any(Array) },
        visitedStages: expect.any(Array),
      },
    });

    // 换一个观看者：投影跟着换人，不是同一份上帝视角。
    const otherView = await app.inject({
      method: "GET",
      url: `/api/v1/games/${SLUG}?actor=${encodeURIComponent("收尸人卡尔")}`,
      headers: auth,
    });
    expect(otherView.statusCode).toBe(200);
    expect(otherView.json()).toMatchObject({ view: { viewer: { name: "收尸人卡尔" } } });

    // 感知日志：单独一个读入口，页面暂不展示。
    const log = await app.inject({
      method: "GET",
      url: `/api/v1/games/${SLUG}/log`,
      headers: auth,
    });
    expect(log.statusCode).toBe(200);
    expect(log.json()).toMatchObject({
      log: { owner: { name: "拾骨人伊莱" }, entries: expect.any(Array) },
    });

    // 控制面投影：上帝视角的活状态。
    const state = await app.inject({
      method: "GET",
      url: `/api/v1/games/${SLUG}/state`,
      headers: auth,
    });
    expect(state.statusCode).toBe(200);
    expect(state.json()).toMatchObject({ state: { game: { slug: SLUG, version: 0 } } });

    const stageMap = await app.inject({
      method: "GET",
      url: `/api/v1/games/${SLUG}/stage-map`,
      headers: auth,
    });
    expect(stageMap.json()).toMatchObject({ stages: { 鸦葬岗: expect.any(Array) } });

    const control = await app.inject({
      method: "POST",
      url: `/api/v1/games/${SLUG}/actors/拾骨人伊莱/control`,
      headers: auth,
      payload: {},
    });
    expect(control.statusCode).toBe(200);
    expect(control.json()).toMatchObject({ result: { controllerType: "player" } });

    // wait 不调模型：这条用例只验证「HTTP → 作业 → 服务层 → 事件流」这条链路。
    const queued = await app.inject({
      method: "POST",
      url: `/api/v1/games/${SLUG}/actors/拾骨人伊莱/actions`,
      headers: auth,
      payload: { action: { kind: "wait" } },
    });
    expect(queued.statusCode).toBe(202);
    expect(queued.json()).toMatchObject({
      job: { status: "pending", kind: "turn.actor.player", result: null },
    });
    const jobId = (queued.json() as { job: { jobId: string } }).job.jobId;

    // 测试里没有常驻 worker：用真实注册表 + 假服务把队列跑一轮。
    const worker = new JobWorker({
      store: new JobStore(handle.db),
      registry: createTurnJobRegistry({
        db: () => handle.db,
        services: () => ({ service: unusedService, inferenceService: unusedService }),
      }),
      queues: [TURN_QUEUE],
    });
    expect(await worker.runOnce()).toBe(1);

    const finished = await app.inject({
      method: "GET",
      url: `/api/v1/games/${SLUG}/jobs/${jobId}`,
      headers: auth,
    });
    expect(finished.statusCode).toBe(200);
    expect(finished.json()).toMatchObject({
      job: { status: "succeeded", result: { ok: true, actions: ["wait"] } },
    });

    const messages = await app.inject({
      method: "GET",
      url: `/api/v1/games/${SLUG}/messages`,
      headers: auth,
    });
    expect(messages.statusCode).toBe(200);
    expect(messages.json()).toMatchObject({ messageCursor: expect.any(Number) });
    expect((messages.json() as { messages: unknown[] }).messages.length).toBeGreaterThan(0);
  });

  it("动作参数组合错误在服务端也被拦下", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/games/${SLUG}/actors/拾骨人伊莱/actions`,
      headers: auth,
      payload: { action: { kind: "use", item: "拾骨钩" } },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "invalid_request" });
  });

  it("建局数据只取建局物化的行，不含运行时集合", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/games/${SLUG}/build`,
      headers: auth,
    });
    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      game: { slug: string };
      world: { name: string };
      stages: unknown[];
      actors: unknown[];
      items: unknown[];
      stageItems: unknown[];
    };
    expect(body.game.slug).toBe(SLUG);
    expect(body.world.name.length).toBeGreaterThan(0);
    expect(body.stages.length).toBeGreaterThan(0);
    expect(body.actors.length).toBeGreaterThan(0);
    expect(body.items.length + body.stageItems.length).toBeGreaterThan(0);
    // 运行时状态不在这里：它每天都在长，不该混进这份可以通读的原文。
    expect(body).not.toHaveProperty("messages");
    expect(body).not.toHaveProperty("memories");
    expect(body).not.toHaveProperty("jobs");
  });

  it("局列表带元信息，且只含当前身份名下的局", async () => {
    const listSlug = `${SLUG}-list`;
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/games",
      headers: auth,
      payload: { seed: "dark-fantasy:crow-grave", slug: listSlug },
    });
    expect(created.statusCode).toBe(200);

    // 别人的局：直接插一行，避开建局路径——这条用例只验证列表的可见性口径。
    const otherUser = {
      id: randomUUID(),
      username: `other-${listSlug}`,
      displayName: "别人",
    };
    await handle.db.insert(users).values(otherUser);
    await handle.db.insert(games).values({
      id: randomUUID(),
      ownerId: otherUser.id,
      slug: `${listSlug}-foreign`,
      name: "别人的局",
      contentVersion: "test",
    });

    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/games?limit=100",
      headers: auth,
    });
    expect(listed.statusCode).toBe(200);

    const body = listed.json() as {
      games: {
        slug: string;
        status: string;
        outcome: string | null;
        clock: number;
        version: number;
        activeJob: unknown;
        updatedAt: string;
      }[];
    };
    const slugs = body.games.map((game) => game.slug);
    expect(slugs).toContain(listSlug);
    expect(slugs).not.toContain(`${listSlug}-foreign`);

    const mine = body.games.find((game) => game.slug === listSlug);
    expect(mine).toMatchObject({
      status: "active",
      outcome: null,
      version: 0,
      clock: 0,
      activeJob: null,
      updatedAt: expect.any(String),
    });

    // 入队一个 NPC 回合但不跑 worker：列表要能看到「这一局现在有回合在跑」。
    const queued = await app.inject({
      method: "POST",
      url: `/api/v1/games/${listSlug}/turns/npc`,
      headers: auth,
      payload: { actor: "收尸人卡尔" },
    });
    expect(queued.statusCode).toBe(202);

    const withActive = await app.inject({
      method: "GET",
      url: "/api/v1/games?limit=100",
      headers: auth,
    });
    const activeRow = (
      withActive.json() as {
        games: {
          slug: string;
          activeJob: { jobId: string; kind: string; status: string } | null;
        }[];
      }
    ).games.find((game) => game.slug === listSlug);
    expect(activeRow?.activeJob).toMatchObject({ status: "pending" });
    // 活跃作业是「这一局在跑什么」，不是跨局共享的一个计数。
    expect(
      (withActive.json() as { games: { slug: string; activeJob: unknown }[] }).games.filter(
        (game) => game.activeJob !== null,
      ),
    ).toHaveLength(1);

    // 状态过滤直接作用在列表上：这一局还没结束，不该出现在 completed 里。
    const completed = await app.inject({
      method: "GET",
      url: "/api/v1/games?status=completed&limit=100",
      headers: auth,
    });
    expect(
      (completed.json() as { games: { slug: string }[] }).games.map((g) => g.slug),
    ).not.toContain(listSlug);
  });

  it("节点自述给出进程、数据库与轨迹目录，且不含凭据", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/status",
      headers: adminAuth,
    });
    expect(response.statusCode).toBe(200);

    const body = response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      listen: { host: expect.any(String), port: expect.any(Number) },
      process: {
        pid: expect.any(Number),
        nodeVersion: expect.any(String),
        startedAt: expect.any(String),
        uptimeSeconds: expect.any(Number),
      },
      trace: {
        enabled: expect.any(Boolean),
        dir: expect.any(String),
        gameDirs: expect.any(Number),
      },
    });
    expect((body.database as { name: string }).name.length).toBeGreaterThan(0);

    const password = new URL(process.env.TEST_DATABASE_URL ?? "").password;
    if (password.length > 0) {
      expect(JSON.stringify(body)).not.toContain(password);
    }

    const anonymous = await app.inject({ method: "GET", url: "/api/v1/status" });
    expect(anonymous.statusCode).toBe(401);
  });

  it("局列表要求登录", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/games" });
    expect(response.statusCode).toBe(401);
  });

  it("运维看全库、玩家只看自己，机器级读数只对运维开放", async () => {
    const otherUser = {
      id: randomUUID(),
      username: `outsider-${SLUG}`,
      displayName: "第三方",
    };
    await handle.db.insert(users).values(otherUser);
    const otherGameId = randomUUID();
    await handle.db.insert(games).values({
      id: otherGameId,
      ownerId: otherUser.id,
      slug: `${SLUG}-outsider`,
      name: "别人的局",
      contentVersion: "test",
    });

    const adminMe = await app.inject({ method: "GET", url: "/api/v1/me", headers: adminAuth });
    expect(adminMe.json()).toMatchObject({ user: { isAdmin: true } });

    // 运维：列表里有别人的局，也能直接打开自己并不拥有的那一局。
    const adminList = await app.inject({
      method: "GET",
      url: "/api/v1/games?limit=100",
      headers: adminAuth,
    });
    expect(
      (adminList.json() as { games: { slug: string; ownerUsername: string }[] }).games,
    ).toContainEqual(
      expect.objectContaining({ slug: `${SLUG}-outsider`, ownerUsername: otherUser.username }),
    );
    const adminRead = await app.inject({
      method: "GET",
      url: `/api/v1/games/${SLUG}`,
      headers: adminAuth,
    });
    expect(adminRead.statusCode).toBe(200);

    // 玩家：列表里没有，打开别人的局是 403（不是 404——局存在，但没有权限）。
    const playerList = await app.inject({
      method: "GET",
      url: "/api/v1/games?limit=100",
      headers: auth,
    });
    expect(
      (playerList.json() as { games: { slug: string }[] }).games.map((game) => game.slug),
    ).not.toContain(`${SLUG}-outsider`);
    const playerRead = await app.inject({
      method: "GET",
      url: `/api/v1/games/${SLUG}-outsider`,
      headers: auth,
    });
    expect(playerRead.statusCode).toBe(403);
    const playerBuild = await app.inject({
      method: "GET",
      url: `/api/v1/games/${SLUG}-outsider/build`,
      headers: auth,
    });
    expect(playerBuild.statusCode).toBe(403);

    // 机器级读数（轨迹、节点自述）只对运维开放。
    const playerTraces = await app.inject({
      method: "GET",
      url: "/api/v1/traces?limit=1",
      headers: auth,
    });
    expect(playerTraces.statusCode).toBe(403);
    const adminTraces = await app.inject({
      method: "GET",
      url: "/api/v1/traces?limit=1",
      headers: adminAuth,
    });
    expect(adminTraces.statusCode).toBe(200);
    const playerStatus = await app.inject({
      method: "GET",
      url: "/api/v1/status",
      headers: auth,
    });
    expect(playerStatus.statusCode).toBe(403);

    await handle.db.delete(games).where(eq(games.id, otherGameId));
    await handle.db.delete(users).where(eq(users.id, otherUser.id));
  });

  it("不存在的局返回 404 而不是 500", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/games/no-such-game",
      headers: auth,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: "not_found" });
  });

  it("OpenAPI 收录动作、顺位与轨迹端点", async () => {
    const response = await app.inject({ method: "GET", url: "/openapi.json" });
    const paths = response.json().paths as Record<string, unknown>;
    expect(Object.keys(paths)).toContain("/api/v1/games/{game}/actors/{actor}/actions");
    expect(Object.keys(paths)).toContain("/api/v1/games/{game}/turns/world");
    expect(Object.keys(paths)).toContain("/api/v1/games/{game}/action-orders");
    expect(Object.keys(paths)).toContain("/api/v1/games/{game}/action-orders/{order}/complete");
    expect(Object.keys(paths)).toContain("/api/v1/traces");
  });
});
