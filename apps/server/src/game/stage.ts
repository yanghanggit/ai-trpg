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
  MAX_STAGE_ANCHOR_WRITES_PER_TURN,
  MAX_STAGE_ANCHORS,
  MAX_STAGE_NOTIFICATIONS_PER_TURN,
  MEMORY_KINDS,
} from "./constants";
import { GameError } from "./errors";
import { appendMemoryMessages, ensureStageOpeningSnapshot, loadAgentMemory } from "./memory";
import { appendStageMemory } from "./observations";
import { isPassageSealed, listOpenNeighborStageNames, openPassage } from "./persistence/edges";
import { lockGameRow } from "./persistence/games";
import { deleteStageItemsByAnchor, listStageItems } from "./persistence/items";
import {
  listStagesOfWorld,
  loadStageInWorld,
  setStageAnchors,
  setStageEnvironment,
} from "./persistence/stages";
import { loadWorldByGame } from "./persistence/worlds";
import {
  buildAddAnchorTool,
  buildInspectActorTool,
  buildNotifyWorldTool,
  buildOpenPassageTool,
  buildRemoveAnchorTool,
  buildSubmitEnvironmentTool,
  buildSubmitStagePlanTool,
  buildUpdateAnchorTool,
  describeObservedActor,
  describeStageAnchors,
  parseAddAnchor,
  parseEnvironment,
  parseOpenPassage,
  parseRemoveAnchor,
  parseUpdateAnchor,
  parseWorldNotification,
} from "./plan";
import { getGameStateSlice, readTurnDelivery } from "./read/game-state";
import { assertStageFacingText } from "./text-guard";
import type { GameStateSlice, StageAction, StagePlan, StageState, StageTurnResult } from "./types";
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
  const canAddAnchor = stage.actions.includes("add_anchor");
  const canRemoveAnchor = stage.actions.includes("remove_anchor");
  const canUpdateAnchor = stage.actions.includes("update_anchor");
  const anchorTools = [
    ...(canAddAnchor ? ["add_anchor"] : []),
    ...(canRemoveAnchor ? ["remove_anchor"] : []),
    ...(canUpdateAnchor ? ["update_anchor"] : []),
  ];
  const actorLines =
    stage.actors.length === 0
      ? "无"
      : stage.actors
          .map(
            (actor) =>
              `${actor.name}：${actor.appearance.text}${isAlive(actor) ? "" : "（已死亡）"}`,
          )
          .join("\n");
  const anchorLines = describeStageAnchors(stage.anchors);
  const moveLines = moves.length === 0 ? "无" : moves.join("、");
  const sealedLines = sealed.length === 0 ? "无" : sealed.join("、");
  const taskLines = [
    ...(canSubmit
      ? [
          "environment 是本场景此刻可被观察到的状态：只有本轮已落账的动作结果真的改变了场景（物品移动、破坏、出现新的可作用点）才提交完整快照；台词、打算、观察与原地等待都不算。",
          "environment 是演员看得见的东西：不能写角色名或 #编号，也不要替演员说出未打通的通道对面是哪里——那是要他们自己发现、问到的事。",
          "没有变化就不要提交 environment；只读工具的观察不是场景变化，角色携带的物品也不属于 environment。",
          "environment 是完整快照，不是差异；同一轮多次提交时后一次覆盖前一次。",
        ]
      : []),
    ...(anchorTools.length > 0
      ? [
          `锚点是场景的可供性，可由你调整：${anchorTools.join(" / ")}。标签场景内唯一，总数有上限；移除锚点会连同其上的物品一起移除；改标签不影响挂在上面的物品。`,
          "锚点不承载效果与后果；某个锚点要怎么才算可用（例如必须先完成某件事），写在本场景设定里，由你裁决。",
        ]
      : ["可交互锚点由内容层固定，本轮不提交、也不能修改；它们只是可供性，不是状态。"]),
    ...(canOpen ? ["打开未开启的通道用 open_passage；它不通知世界，也不改变对面场景。"] : []),
    ...(canNotify
      ? [
          "需要向世界报告时用 notify_world，写清发生了什么与需要裁决什么；只更新 environment 不会让世界知道。本场景设定明确要求报告世界的事实，必须使用 notify_world。",
        ]
      : []),
    "读完就调用 submit_stage_plan 提交；写动作与提交可以放在同一次回复里，没有改动就提交空计划。",
    "只读工具（inspect_actor）可以在同一次回复里多次调用，不占写额度，但每一次回复都算一轮推理；本轮会写库的动作最多：environment 一次、锚点一次、通道一条、world 通知两条。",
  ];

  return `# 当前场景

## 场景
${stage.name}
${stage.profile}

## 当前环境
${stage.environment}

## 同场景角色
${actorLines}

## 可交互锚点
${anchorLines}

## 可去场景
${moveLines}

## 未开启的通道
${sealedLines}

# 本轮任务

${taskLines.join("\n")}`;
}

/**
 * environment / 锚点文本的写入守卫：角色名、编号，以及「还没打通的场景名」。
 *
 * 演员能看见的只有从本场景走得到的地方；未开启通道对面叫什么，要靠发现和对话浮出来，
 * 不能由一句环境描写替你宣布。允许点名的集合在写入时现查，跟着通道开合一起变。
 */
function stageFacingGuard(input: {
  actorNames: readonly string[];
  stageNames: readonly string[];
  visibleStageNames: ReadonlySet<string>;
}) {
  return (text: string, label: string): void => assertStageFacingText(text, { ...input, label });
}

type StoredAnchor = { key: string; label: string; description?: string };
type AnchorWrite = Extract<StageAction, { kind: "add_anchor" | "remove_anchor" | "update_anchor" }>;

function isAnchorWrite(action: StageAction): action is AnchorWrite {
  return (
    action.kind === "add_anchor" ||
    action.kind === "remove_anchor" ||
    action.kind === "update_anchor"
  );
}

function anchorText(
  text: string,
  guard: (text: string, label: string) => void,
  what: string,
): string {
  const value = text.trim();
  if (value.length === 0) {
    throw new GameError("invalid_action", `${what} 不能为空。`);
  }
  if (/[\r\n]/.test(value)) {
    throw new GameError("invalid_action", `${what} 不能换行。`);
  }
  guard(value, what);
  return value;
}

function describeStoredAnchors(anchors: readonly StoredAnchor[]): string {
  return anchors.length === 0
    ? "无"
    : anchors
        .map((anchor) =>
          anchor.description ? `- ${anchor.label}：${anchor.description}` : `- ${anchor.label}`,
        )
        .join("\n");
}

/**
 * 纯计算：校验一条锚点变更并返回新列表与摘要。物品挂在锚点的 key 上：
 * 改写标签不换 key，移除锚点则连带移除它上面的物品。
 */
function computeAnchorChange(
  current: readonly StoredAnchor[],
  itemsByAnchor: ReadonlyMap<string, readonly string[]>,
  action: AnchorWrite,
  guard: (text: string, label: string) => void,
): { anchors: StoredAnchor[]; summary: string; removedAnchorKey?: string } {
  const anchors = current.map((anchor) => ({ ...anchor }));
  if (action.kind === "add_anchor") {
    if (anchors.length >= MAX_STAGE_ANCHORS) {
      throw new GameError("invalid_action", `锚点最多 ${MAX_STAGE_ANCHORS} 个。`);
    }
    const label = anchorText(action.label, guard, "锚点 label");
    if (anchors.some((anchor) => anchor.label === label)) {
      throw new GameError("invalid_action", `锚点 label 重复：${label}。`);
    }
    const description =
      action.description === undefined
        ? undefined
        : anchorText(action.description, guard, "锚点 description");
    anchors.push({
      key: randomUUID(),
      label,
      ...(description === undefined ? {} : { description }),
    });
    return { anchors, summary: `新增：${label}` };
  }

  const index = anchors.findIndex((anchor) => anchor.label === action.targetAnchor);
  const target = anchors[index];
  if (!target) {
    throw new GameError("invalid_action", `当前场景没有这个可交互锚点: ${action.targetAnchor}`);
  }
  if (action.kind === "remove_anchor") {
    const removedItems = itemsByAnchor.get(target.key) ?? [];
    anchors.splice(index, 1);
    return {
      anchors,
      summary:
        removedItems.length === 0
          ? `移除：${target.label}`
          : `移除：${target.label}（带走 ${removedItems.join("、")}）`,
      removedAnchorKey: target.key,
    };
  }

  const label = anchorText(action.label, guard, "锚点 label");
  if (anchors.some((anchor, currentIndex) => currentIndex !== index && anchor.label === label)) {
    throw new GameError("invalid_action", `锚点 label 重复：${label}。`);
  }
  const description =
    action.description === undefined
      ? undefined
      : anchorText(action.description, guard, "锚点 description");
  anchors[index] = {
    key: target.key,
    label,
    ...(description === undefined ? {} : { description }),
  };
  return {
    anchors,
    summary: target.label === label ? `更新：${label}` : `更新：${target.label} → ${label}`,
  };
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
    // 先补基线，再写本轮结论与事件。
    if (await ensureStageOpeningSnapshot(tx, memory, stage)) {
      await traceEvent(trace, {
        event: "observed",
        via: "stage-memory",
        kind: MEMORY_KINDS.stageOpeningSnapshot,
        stageId: stage.id,
      });
    }
    const actorNames = (await listActorNamesInWorld(tx, world.id)).map((actor) => actor.name);
    const stagesOfWorld = await listStagesOfWorld(tx, world.id);
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
      action.kind === "submit_environment" ? [action.environment] : [],
    );
    const notifications = plan.actions.flatMap((action) =>
      action.kind === "notify_world" ? [action.notification] : [],
    );
    const passages = plan.actions.flatMap((action) =>
      action.kind === "open_passage" ? [action.targetStageName] : [],
    );
    const anchorWrites = plan.actions.filter(isAnchorWrite);
    // 允许点名的场景：本场景自己的名字，加上开着的出入边对面，以及本轮就要打开的那条。
    // 边表只有本 world 的十几行，跟着回合查一次比按需缓存更好读。
    const guardStageFacing = stageFacingGuard({
      actorNames,
      stageNames: stagesOfWorld.map((candidate) => candidate.name),
      visibleStageNames: new Set([
        stage.name,
        ...(await listOpenNeighborStageNames(tx, world.id, stage.id)),
        ...passages,
      ]),
    });
    if (environments.length > 1) {
      return reject("本轮最多一次 environment 更新。", MEMORY_KINDS.actionRejected);
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
    if (notifications.length > 0 && !stageActions.includes("notify_world")) {
      return reject("通知被拒绝：本场景没有 notify_world 能力。", MEMORY_KINDS.actionRejected);
    }
    if (passages.length > 0 && !stageActions.includes("open_passage")) {
      return reject("通道变更被拒绝：本场景没有 open_passage 能力。", MEMORY_KINDS.actionRejected);
    }
    if (anchorWrites.length > MAX_STAGE_ANCHOR_WRITES_PER_TURN) {
      return reject(
        `本轮最多调整 ${MAX_STAGE_ANCHOR_WRITES_PER_TURN} 个锚点。`,
        MEMORY_KINDS.actionRejected,
      );
    }
    for (const action of anchorWrites) {
      if (!stageActions.includes(action.kind)) {
        return reject(
          `锚点变更被拒绝：本场景没有 ${action.kind} 能力。`,
          MEMORY_KINDS.actionRejected,
        );
      }
    }
    let anchorChange: {
      action: AnchorWrite;
      anchors: StoredAnchor[];
      summary: string;
      removedAnchorKey?: string;
    } | null = null;
    if (anchorWrites.length > 0 && anchorWrites[0]) {
      const stored: StoredAnchor[] = stage.anchors.map((anchor) => ({
        key: anchor.key,
        label: anchor.label,
        ...(anchor.description === undefined ? {} : { description: anchor.description }),
      }));
      const itemsByAnchor = new Map<string, string[]>();
      for (const item of await listStageItems(tx, stage.id)) {
        const list = itemsByAnchor.get(item.anchorKey) ?? [];
        list.push(item.name);
        itemsByAnchor.set(item.anchorKey, list);
      }
      try {
        anchorChange = {
          action: anchorWrites[0],
          ...computeAnchorChange(stored, itemsByAnchor, anchorWrites[0], guardStageFacing),
        };
      } catch (error) {
        if (!(error instanceof GameError)) {
          throw error;
        }
        return reject(`锚点变更被拒绝：${error.message}`, MEMORY_KINDS.actionRejected);
      }
    }

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
        guardStageFacing(environment, "environment");
      } catch (error) {
        if (!(error instanceof GameError)) {
          throw error;
        }
        return reject(`环境更新被拒绝：${error.message}`, MEMORY_KINDS.actionRejected);
      }
    }

    const now = new Date();
    for (const action of plan.actions) {
      if (action.kind === "submit_environment") {
        if (action.environment !== stage.environment) {
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

      if (
        action.kind === "add_anchor" ||
        action.kind === "remove_anchor" ||
        action.kind === "update_anchor"
      ) {
        if (!anchorChange || anchorChange.action !== action) {
          throw new GameError("invalid_state", "锚点变更没有通过校验");
        }
        if (anchorChange.removedAnchorKey !== undefined) {
          await deleteStageItemsByAnchor(tx, stage.id, anchorChange.removedAnchorKey);
        }
        await setStageAnchors(tx, stage.id, anchorChange.anchors);
        const content = `${stage.name}的可交互点发生了变化。\n${anchorChange.summary}\n${describeStoredAnchors(anchorChange.anchors)}`;
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

  const inspectTool = buildInspectActorTool(
    stage.actors.map((actor) => actor.name),
    "stage",
  );
  const canSubmit = stage.actions.includes("submit_environment");
  const canNotify = stage.actions.includes("notify_world");
  const sealed = sealedStageNames(state, stage.id);
  const canOpen = stage.actions.includes("open_passage") && sealed.length > 0;
  const canAddAnchor = stage.actions.includes("add_anchor");
  const canRemoveAnchor = stage.actions.includes("remove_anchor");
  const canUpdateAnchor = stage.actions.includes("update_anchor");
  const submitTool = buildSubmitEnvironmentTool();
  const planTool = buildSubmitStagePlanTool();
  const notifyTool = buildNotifyWorldTool();
  const openTool = buildOpenPassageTool(sealed);
  const anchorLabels = stage.anchors.map((anchor) => anchor.label);
  const addAnchorTool = buildAddAnchorTool();
  const removeAnchorTool = buildRemoveAnchorTool(anchorLabels);
  const updateAnchorTool = buildUpdateAnchorTool(anchorLabels);
  const actions: StageAction[] = [];
  let submitted: StagePlan | null = null;

  /** 每次写入后都刷新一次快照；模型忘记调终结工具时本轮动作也不会丢。 */
  const submit = (): StagePlan => {
    const plan = { actions: actions.map((action) => ({ ...action })) };
    submitted = plan;
    return plan;
  };

  /** 锚点一轮只调一次：超出额度在工具层就给反馈，不浪费一个回合。 */
  const pushAnchor = (action: StageAction): void => {
    if (actions.filter(isAnchorWrite).length >= MAX_STAGE_ANCHOR_WRITES_PER_TURN) {
      throw new GameError(
        "invalid_action",
        `本轮最多调整 ${MAX_STAGE_ANCHOR_WRITES_PER_TURN} 个锚点`,
      );
    }
    actions.push(action);
    submit();
  };

  const loop = await agentLoop({
    name: stage.name,
    inputMessage: buildStageTurnInput(state, stage),
    messages: memory.messages,
    tools: [
      inspectTool,
      ...(canSubmit ? [submitTool] : []),
      ...(canNotify ? [notifyTool] : []),
      ...(canOpen ? [openTool] : []),
      ...(canAddAnchor ? [addAnchorTool] : []),
      ...(canRemoveAnchor ? [removeAnchorTool] : []),
      ...(canUpdateAnchor ? [updateAnchorTool] : []),
      planTool,
    ],
    handlers: {
      [inspectTool.function.name]: (args) => {
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
              if (environment === undefined) {
                throw new GameError("invalid_action", "submit_environment 需要非空 environment");
              }
              const index = actions.findIndex((action) => action.kind === "submit_environment");
              if (index >= 0) {
                actions[index] = { kind: "submit_environment", environment };
              } else {
                actions.push({ kind: "submit_environment", environment });
              }
              submit();
              return "environment 已加入本轮计划";
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
      ...(canAddAnchor
        ? {
            [addAnchorTool.function.name]: (args: Record<string, unknown>) => {
              pushAnchor(parseAddAnchor(args));
              return "锚点已加入本轮计划";
            },
          }
        : {}),
      ...(canRemoveAnchor
        ? {
            [removeAnchorTool.function.name]: (args: Record<string, unknown>) => {
              pushAnchor(parseRemoveAnchor(args));
              return "锚点移除已加入本轮计划";
            },
          }
        : {}),
      ...(canUpdateAnchor
        ? {
            [updateAnchorTool.function.name]: (args: Record<string, unknown>) => {
              pushAnchor(parseUpdateAnchor(args));
              return "锚点更新已加入本轮计划";
            },
          }
        : {}),
      [planTool.function.name]: () => {
        submit();
        return "计划已提交";
      },
    },
    terminalTools: [planTool],
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
