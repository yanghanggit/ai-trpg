import { randomUUID } from "node:crypto";
import type { Database } from "../db/pool";
import { createTurnTrace, type TraceContext, traceEvent } from "../debug/trace";
import { agentLoop } from "../llm/agent-loop";
import type { ChatCompletionService } from "../llm/protocol";
import { adjacentStageNames, findStage, sealedStageNames } from "./actors";
import { appendPublicMessage, bumpGameVersion } from "./apply/messages";
import { isAlive, listActorNamesInWorld } from "./apply/queries";
import {
  DEFAULT_LLM_ERROR_RETRIES,
  DEFAULT_STAGE_MAX_ROUNDS,
  MAX_STAGE_ANCHORS,
  MAX_STAGE_NOTIFICATIONS_PER_TURN,
  MEMORY_KINDS,
} from "./constants";
import { GameError } from "./errors";
import { appendMemoryMessages, loadAgentMemory } from "./memory";
import { appendStageMemory } from "./observations";
import { isPassageSealed, openPassage } from "./persistence/edges";
import { lockGameRow } from "./persistence/games";
import {
  listStagesOfWorld,
  loadStageInWorld,
  setStageAnchors,
  setStageEnvironment,
} from "./persistence/stages";
import { loadWorldByGame } from "./persistence/worlds";
import {
  buildNotifyWorldTool,
  buildObserveActorTool,
  buildOpenPassageTool,
  buildSubmitEnvironmentTool,
  describeObservedActor,
  describeStageAnchors,
  parseAnchors,
  parseEnvironment,
  parseOpenPassage,
  parseWorldNotification,
} from "./plan";
import { getGameStateSlice, readTurnDelivery } from "./read/game-state";
import { assertWorldFaceText } from "./text-guard";
import type {
  GameStateSlice,
  StageAction,
  StageAnchor,
  StagePlan,
  StageState,
  StageTurnResult,
} from "./types";
import { appendWorldNotification } from "./world-events";

export type StageTurnOptions = {
  service: ChatCompletionService;
  maxRounds?: number;
  logger?: Parameters<typeof agentLoop>[0]["logger"];
};

/** 构造 stage 小 GM 本轮的当前场景观察；仲裁与探针共用。 */
export function buildStageTurnInput(state: GameStateSlice, stage: StageState): string {
  const moves = adjacentStageNames(state, stage.id);
  const sealed = sealedStageNames(state, stage.id);
  const canSubmit = stage.actions.includes("submit_environment");
  const canOpen = stage.actions.includes("open_passage");
  const canNotify = stage.actions.includes("notify_world");
  const actorLines =
    stage.actors.length === 0
      ? "无"
      : stage.actors
          .map(
            (actor) =>
              `${actor.name}：${actor.appearance.text}${isAlive(actor) ? "" : "（已死亡）"}`,
          )
          .join("\n");
  const itemLines =
    stage.items.length === 0
      ? "无"
      : stage.items.map((item) => `${item.name}（${item.kind}）：${item.description}`).join("\n");
  const anchorLines = describeStageAnchors(stage.anchors);
  const moveLines = moves.length === 0 ? "无" : moves.join("、");
  const sealedLines = sealed.length === 0 ? "无" : sealed.join("、");
  const taskLines = [
    ...(canSubmit
      ? [
          "根据当前环境与本场景记忆，提交本场景的完整 environment 与可交互锚点；没有变化也要原样提交，不能省略；相同快照不会重复写事件。",
          "只有已落账的动作结果改变了场景（物品移动、破坏或出现新的可作用点）才改写；台词、打算、观察与原地等待都不算。",
          "本轮只有台词、观察或原地等待时，environment 与 anchors 必须原样提交，不得新增描写。",
        ]
      : []),
    ...(canOpen ? ["打开未开启的通道用 open_passage；它不通知世界，也不改变对面场景。"] : []),
    ...(canNotify
      ? [
          "需要向世界报告时用 notify_world（判断标准见「场景职责」），写清发生了什么与需要裁决什么；只更新 environment 不会让世界知道。本场景设定明确要求报告世界的事实，必须使用 notify_world。",
        ]
      : []),
    ...(canSubmit
      ? [
          "notify_world 与 open_passage 只把动作加入计划；加完后仍要调用 submit_environment 结束本轮。",
          "本轮至少要有一项写库动作：environment/锚点、通道或通知；都没有的计划会被拒绝。",
        ]
      : []),
    "只读工具（observe_actor）可以多次调用，不占额度；本轮会写库的动作最多：environment/anchors 一次、通道一条、world 通知两条。",
    "规则见「场景职责」。",
  ];

  return `# 当前场景

## 场景
${stage.name}
${stage.profile}

## 当前环境
${stage.environment}

## 同场景角色
${actorLines}

## 场景物品
${itemLines}

## 可交互锚点
${anchorLines}

## 可去场景
${moveLines}

## 未开启的通道
${sealedLines}

# 本轮任务

${taskLines.join("\n")}`;
}

function assertEnvironmentHasNoLeaks(environment: string, actorNames: readonly string[]): void {
  assertWorldFaceText(environment, actorNames, "environment");
}

function normalizeAnchors(anchors: readonly StageAnchor[]): StageAnchor[] {
  return anchors.map((anchor) => {
    const description = anchor.description?.trim();
    return {
      label: anchor.label.trim(),
      ...(description ? { description } : {}),
    };
  });
}

/** 返回拒绝原因；null 表示通过。 */
function validateAnchors(
  anchors: readonly StageAnchor[],
  actorNames: readonly string[],
): string | null {
  if (anchors.length > MAX_STAGE_ANCHORS) {
    return `锚点最多 ${MAX_STAGE_ANCHORS} 个。`;
  }
  const labels = new Set<string>();
  for (const anchor of anchors) {
    if (anchor.label.length === 0) {
      return "锚点 label 不能为空。";
    }
    if (/[\r\n]/.test(anchor.label)) {
      return "锚点 label 不能换行。";
    }
    if (labels.has(anchor.label)) {
      return `锚点 label 重复：${anchor.label}。`;
    }
    labels.add(anchor.label);
    try {
      assertWorldFaceText(anchor.label, actorNames, "锚点 label");
      if (anchor.description) {
        assertWorldFaceText(anchor.description, actorNames, "锚点 description");
      }
    } catch (error) {
      if (error instanceof GameError) {
        return error.message;
      }
      throw error;
    }
  }
  return null;
}

/** 计划非法时写入 stage memory 并返回 false；数据库错误继续抛出。 */
export async function applyStagePlan(
  db: Database,
  gameId: string,
  stageId: string,
  plan: StagePlan | null,
  loopSuccess: boolean,
  trace?: TraceContext,
): Promise<boolean> {
  await traceEvent(trace, { event: "plan", actions: plan?.actions ?? [] });
  return db.transaction(async (tx) => {
    const game = await lockGameRow(tx, gameId);
    if (!game) {
      throw new GameError("not_found", `游戏不存在: ${gameId}`);
    }
    if (game.status !== "active") {
      throw new GameError("invalid_state", `游戏已结束，不能继续行动: ${game.status}`);
    }
    const world = await loadWorldByGame(tx, gameId);
    if (!world) {
      throw new GameError("invalid_state", `游戏缺少 world: ${gameId}`);
    }
    const stage = await loadStageInWorld(tx, stageId, world.id);
    if (!stage) {
      throw new GameError("not_found", `stage 不存在: ${stageId}`);
    }
    const memory = await loadAgentMemory(tx, gameId, "stage", stage.id);
    if (!memory) {
      throw new GameError("invalid_state", `stage 缺少 memory: ${stage.id}`);
    }
    const actorNames = (await listActorNamesInWorld(tx, world.id)).map((actor) => actor.name);
    const stageActions = stage.actions;

    const reject = async (content: string, kind: string): Promise<false> => {
      await appendMemoryMessages(tx, memory.row.id, [
        {
          type: "human",
          content: `# 仲裁结果\n${content}`,
          metadata: { kind, loopSuccess },
        },
      ]);
      await traceEvent(trace, { event: "rejected", code: kind, reason: content });
      return false;
    };

    if (!plan) {
      return reject("本轮没有提交有效计划，状态未改变。", MEMORY_KINDS.planFailed);
    }

    const environments = plan.actions.flatMap((action) =>
      action.kind === "submit_environment" && action.environment !== undefined
        ? [action.environment]
        : [],
    );
    const anchorUpdates = plan.actions.flatMap((action) =>
      action.kind === "submit_environment" && action.anchors !== undefined ? [action.anchors] : [],
    );
    const notifications = plan.actions.flatMap((action) =>
      action.kind === "notify_world" ? [action.notification] : [],
    );
    const passages = plan.actions.flatMap((action) =>
      action.kind === "open_passage" ? [action.targetStageName] : [],
    );
    if (environments.length > 1) {
      return reject("本轮最多一次 environment 更新。", MEMORY_KINDS.actionRejected);
    }
    if (anchorUpdates.length > 1) {
      return reject("本轮最多一次锚点更新。", MEMORY_KINDS.actionRejected);
    }
    if (passages.length > 1) {
      return reject("本轮最多打开一条通道。", MEMORY_KINDS.actionRejected);
    }
    if (notifications.length > MAX_STAGE_NOTIFICATIONS_PER_TURN) {
      throw new GameError(
        "invalid_state",
        `本轮最多 ${MAX_STAGE_NOTIFICATIONS_PER_TURN} 条 world 通知`,
      );
    }
    if (
      environments.length === 0 &&
      anchorUpdates.length === 0 &&
      notifications.length === 0 &&
      passages.length === 0
    ) {
      return reject(
        "本轮没有 environment、锚点、通道或 world 通知，状态未改变。",
        MEMORY_KINDS.planFailed,
      );
    }
    if (notifications.length > 0 && !stageActions.includes("notify_world")) {
      return reject("通知被拒绝：本场景没有 notify_world 能力。", MEMORY_KINDS.actionRejected);
    }
    if (passages.length > 0 && !stageActions.includes("open_passage")) {
      return reject("通道变更被拒绝：本场景没有 open_passage 能力。", MEMORY_KINDS.actionRejected);
    }

    const stagesOfWorld = await listStagesOfWorld(tx, world.id);
    const stageByName = new Map(stagesOfWorld.map((candidate) => [candidate.name, candidate]));
    for (const targetStageName of passages) {
      const target = stageByName.get(targetStageName);
      if (!target) {
        return reject("通道变更被拒绝：目标场景不存在。", MEMORY_KINDS.actionRejected);
      }
      if (!(await isPassageSealed(tx, world.id, stage.id, target.id))) {
        return reject(
          `通道变更被拒绝：没有从 ${stage.name} 到 ${target.name} 的未开启通道。`,
          MEMORY_KINDS.actionRejected,
        );
      }
    }
    for (const environment of environments) {
      try {
        assertEnvironmentHasNoLeaks(environment, actorNames);
      } catch (error) {
        if (!(error instanceof GameError)) {
          throw error;
        }
        return reject(`环境更新被拒绝：${error.message}`, MEMORY_KINDS.actionRejected);
      }
    }
    for (const anchors of anchorUpdates) {
      const error = validateAnchors(normalizeAnchors(anchors), actorNames);
      if (error !== null) {
        return reject(`锚点更新被拒绝：${error}`, MEMORY_KINDS.actionRejected);
      }
    }

    const now = new Date();
    for (const action of plan.actions) {
      if (action.kind === "submit_environment") {
        if (action.environment !== undefined && action.environment !== stage.environment) {
          await setStageEnvironment(tx, stage.id, action.environment);
          const content = `${stage.name}的环境发生了变化。\n${action.environment}`;
          await appendPublicMessage(tx, gameId, null, {
            kind: "environment_change",
            stageId: stage.id,
            visibility: "stage",
            content,
          });
          await appendStageMemory(
            tx,
            gameId,
            stage.id,
            `# 场景事件\n${content}`,
            { eventKind: "environment_change" },
            trace,
          );
          await traceEvent(trace, { event: "applied", actionKind: action.kind, feedback: content });
        }
        if (action.anchors !== undefined) {
          const anchors = normalizeAnchors(action.anchors);
          const unchanged =
            JSON.stringify(anchors) === JSON.stringify(normalizeAnchors(stage.anchors));
          if (!unchanged) {
            await setStageAnchors(tx, stage.id, anchors);
            const anchorText =
              anchors.length === 0
                ? "无"
                : anchors
                    .map((anchor) =>
                      anchor.description
                        ? `- ${anchor.label}：${anchor.description}`
                        : `- ${anchor.label}`,
                    )
                    .join("\n");
            const content = `${stage.name}的可交互位置发生了变化。\n${anchorText}`;
            await appendPublicMessage(tx, gameId, null, {
              kind: "anchor_change",
              stageId: stage.id,
              visibility: "stage",
              content,
            });
            await appendStageMemory(
              tx,
              gameId,
              stage.id,
              `# 场景事件\n${content}`,
              { eventKind: "anchor_change" },
              trace,
            );
            await traceEvent(trace, {
              event: "applied",
              actionKind: action.kind,
              feedback: content,
            });
          }
        }
        continue;
      }

      if (action.kind === "open_passage") {
        const target = stageByName.get(action.targetStageName);
        if (!target) {
          throw new GameError("invalid_state", `通道目标场景不存在: ${action.targetStageName}`);
        }
        const opened = await openPassage(tx, world.id, stage.id, target.id);
        if (!opened) {
          throw new GameError(
            "invalid_state",
            `没有通往 ${target.name} 的未开启通道: ${stage.name}`,
          );
        }
        const content = `${stage.name}通往${target.name}的通道开启了。`;
        await appendPublicMessage(tx, gameId, null, {
          kind: "passage_change",
          stageId: stage.id,
          visibility: "stage",
          content,
        });
        await appendStageMemory(
          tx,
          gameId,
          stage.id,
          `# 场景事件\n${content}`,
          { eventKind: "passage_change", targetStageId: target.id },
          trace,
        );
        await traceEvent(trace, { event: "applied", actionKind: action.kind, feedback: content });
        continue;
      }

      await appendWorldNotification(tx, gameId, world.id, stage, action.notification, trace);
      await appendStageMemory(
        tx,
        gameId,
        stage.id,
        `# 场景事件\n${stage.name}向世界发出通知：${action.notification}`,
        { eventKind: "world_notification" },
        trace,
      );
      await traceEvent(trace, {
        event: "applied",
        actionKind: action.kind,
        feedback: action.notification,
      });
    }

    await bumpGameVersion(tx, gameId, now);
    return true;
  });
}

/** stage 回合由调用方显式推动，不随 actor 行动自动运行。 */
export async function runStageTurn(
  db: Database,
  gameRef: string,
  stageRef: string,
  options: StageTurnOptions,
): Promise<StageTurnResult> {
  const state = await getGameStateSlice(db, gameRef);
  if (state.game.status !== "active") {
    throw new GameError("invalid_state", `游戏已结束: ${state.game.status}`);
  }
  const stage = findStage(state, stageRef);
  const memory = await loadAgentMemory(db, state.game.id, "stage", stage.id);
  if (!memory) {
    throw new GameError("invalid_state", `stage 缺少 memory: ${stage.name}`);
  }

  const trace = createTurnTrace({ game: state.game, turnKind: "stage" });
  await traceEvent(trace, {
    event: "turn_start",
    label: stage.name,
    stageId: stage.id,
    stageName: stage.name,
    contentVersion: state.game.contentVersion,
  });

  const observeTool = buildObserveActorTool(
    stage.actors.map((actor) => actor.name),
    "stage",
  );
  const canSubmit = stage.actions.includes("submit_environment");
  const canNotify = stage.actions.includes("notify_world");
  const sealed = sealedStageNames(state, stage.id);
  const canOpen = stage.actions.includes("open_passage") && sealed.length > 0;
  const submitTool = buildSubmitEnvironmentTool();
  const notifyTool = buildNotifyWorldTool();
  const openTool = buildOpenPassageTool(sealed);
  const actions: StageAction[] = [];
  let submitted: StagePlan | null = null;

  /** 每次写入后都刷新一次快照；模型忘记调终止工具时本轮动作也不会丢。 */
  const submit = (): StagePlan => {
    const plan = { actions: actions.map((action) => ({ ...action })) };
    submitted = plan;
    return plan;
  };

  const loop = await agentLoop({
    name: stage.name,
    inputMessage: buildStageTurnInput(state, stage),
    messages: memory.messages,
    tools: [
      observeTool,
      ...(canSubmit ? [submitTool] : []),
      ...(canNotify ? [notifyTool] : []),
      ...(canOpen ? [openTool] : []),
    ],
    handlers: {
      [observeTool.function.name]: (args) => {
        const targetActorRef =
          typeof args.targetActorRef === "string" ? args.targetActorRef.trim() : "";
        const target = stage.actors.find((actor) => actor.name === targetActorRef);
        if (!target) {
          return `错误：当前场景内找不到角色 ${targetActorRef}`;
        }
        return describeObservedActor(target);
      },
      ...(canSubmit
        ? {
            [submitTool.function.name]: (args: Record<string, unknown>) => {
              const environment = parseEnvironment(args);
              const anchors = parseAnchors(args);
              if (environment !== undefined || anchors !== undefined) {
                const index = actions.findIndex((action) => action.kind === "submit_environment");
                const current = index >= 0 ? actions[index] : undefined;
                const next: StageAction = {
                  kind: "submit_environment",
                  ...(current?.kind === "submit_environment" && current.environment !== undefined
                    ? { environment: current.environment }
                    : {}),
                  ...(current?.kind === "submit_environment" && current.anchors !== undefined
                    ? { anchors: current.anchors }
                    : {}),
                  ...(environment !== undefined ? { environment } : {}),
                  ...(anchors !== undefined ? { anchors } : {}),
                };
                if (index >= 0) {
                  actions[index] = next;
                } else {
                  actions.push(next);
                }
              }
              if (actions.length === 0) {
                throw new GameError(
                  "invalid_action",
                  "计划必须包含 environment、锚点、通道开启或至少一条 notify_world 通知",
                );
              }
              submit();
              return "计划已提交";
            },
          }
        : {}),
      ...(canNotify
        ? {
            [notifyTool.function.name]: (args: Record<string, unknown>) => {
              const count = actions.filter((action) => action.kind === "notify_world").length;
              if (count >= MAX_STAGE_NOTIFICATIONS_PER_TURN) {
                throw new GameError(
                  "invalid_action",
                  `本轮最多 ${MAX_STAGE_NOTIFICATIONS_PER_TURN} 条 world 通知`,
                );
              }
              actions.push({ kind: "notify_world", notification: parseWorldNotification(args) });
              submit();
              return "通知已加入本轮计划";
            },
          }
        : {}),
      ...(canOpen
        ? {
            [openTool.function.name]: (args: Record<string, unknown>) => {
              const count = actions.filter((action) => action.kind === "open_passage").length;
              if (count >= 1) {
                throw new GameError("invalid_action", "本轮最多打开一条通道");
              }
              actions.push(parseOpenPassage(args));
              submit();
              return "通道开启已加入本轮计划";
            },
          }
        : {}),
    },
    terminalTools: canSubmit ? [submitTool] : [],
    service: options.service,
    maxRounds: options.maxRounds ?? DEFAULT_STAGE_MAX_ROUNDS,
    errorRetries: DEFAULT_LLM_ERROR_RETRIES,
    loopId: randomUUID(),
    ...(options.logger ? { logger: options.logger } : {}),
    ...(trace ? { trace } : {}),
  });

  const ok = await applyStagePlan(db, state.game.id, stage.id, submitted, loop.success, trace);
  await traceEvent(trace, { event: "turn_end", ok, loopSuccess: loop.success });

  return {
    ...(await readTurnDelivery(db, state.game.id)),
    ok,
    plan: submitted,
    loopSuccess: loop.success,
  };
}
