import { and, eq, gte } from "drizzle-orm";
import type { Database } from "../db/pool";
import { agentMemories, agentMemoryMessages, games } from "../db/schema";
import {
  ChatCompletionRequest,
  type ChatCompletionService,
  type ChatMessage,
  getBufferString,
} from "../llm";
import { allActors, findActorByName, findStage } from "./actors";
import { buildCampaignSettingBlock, type CampaignContextWorld } from "./campaign-context";
import { MEMORY_KINDS } from "./constants";
import { GameError } from "./errors";
import { appendMemoryMessages, loadAgentMemory, type MemoryOwnerType } from "./memory";
import { findNameLeaks, type NameAuditInput } from "./name-audit";
import { loadNameAuditInput } from "./persistence/name-audit";
import { getGameState } from "./service";
import type { AgentMemoryState, GameState } from "./types";

/** 手动 compact 的目标；actor/stage 用名称或 id，world 不需要名称。 */
export type CompactTarget =
  | { ownerType: "actor"; ref: string }
  | { ownerType: "stage"; ref: string }
  | { ownerType: "world" };

export type CompactMemoryOptions = {
  service: ChatCompletionService;
  /** 只有当前 contextUsageRatio 达到该值才压缩；省略时总是压缩。 */
  minRatio?: number;
};

export type CompactMemoryResult = {
  ownerType: MemoryOwnerType;
  ownerName: string;
  skipped: boolean;
  reason?: string;
  contextUsageRatio: number;
  beforeMessages: number;
  afterMessages: number;
  summary?: string;
};

type ResolvedOwner = {
  ownerType: MemoryOwnerType;
  ownerId: string;
  ownerName: string;
};

const COMPACT_SYSTEM_PROMPT = `你是记忆压缩器，不是记忆主体。

把待压缩记忆写成一段第二人称“你”的私有记忆，供该主体在后续回合直接读取。
保留仍然有效的身份与处境、目标与底线、关键关系、重要物品与地点、已经发生的关键事件、当前未解决的冲突，以及会改变后续行动的事实。
删除重复描述、完整工具调用轨迹、一次性环境描写和已经失效的细节。
不要新增记忆中没有出现的事实，不要编造心理活动，不要写“系统”“模型”“压缩”等元语言。
只输出一段正文，不要标题，不要解释。`;

function resolveActorOwner(state: GameState, ref: string): ResolvedOwner {
  const current = findActorByName(state, ref);
  return { ownerType: "actor", ownerId: current.actor.id, ownerName: current.actor.name };
}

function resolveStageOwner(state: GameState, ref: string): ResolvedOwner {
  const stage = findStage(state, ref);
  return { ownerType: "stage", ownerId: stage.id, ownerName: stage.name };
}

function resolveWorldOwner(state: GameState): ResolvedOwner {
  return { ownerType: "world", ownerId: state.world.id, ownerName: state.world.name };
}

function resolveTarget(state: GameState, target: CompactTarget): ResolvedOwner {
  switch (target.ownerType) {
    case "actor":
      return resolveActorOwner(state, target.ref);
    case "stage":
      return resolveStageOwner(state, target.ref);
    case "world":
      return resolveWorldOwner(state);
  }
}

function resolveAllOwners(state: GameState): ResolvedOwner[] {
  return [
    resolveWorldOwner(state),
    ...state.world.stages.map((stage) => ({
      ownerType: "stage" as const,
      ownerId: stage.id,
      ownerName: stage.name,
    })),
    ...allActors(state).map(({ actor }) => ({
      ownerType: "actor" as const,
      ownerId: actor.id,
      ownerName: actor.name,
    })),
  ];
}

/**
 * actor 的 compact 摘要会回灌成长期记忆，落账前用名字审计的同一套白名单再检查一次：
 * 摘要可以出现观察者自己的名字，或它已经用真名称呼过的其他 actor；其他真名说明
 * 压缩 agent 把未认知的名字重新写了回来，拒绝本次压缩，保留旧 memory。
 */
function assertActorSummaryKnown(
  input: NameAuditInput,
  owner: ResolvedOwner,
  summary: string,
): void {
  const observer = input.actors.find((actor) => actor.id === owner.ownerId);
  if (!observer) {
    throw new GameError("invalid_state", `压缩主体不在 actor 列表中: ${owner.ownerName}`);
  }
  const memory: AgentMemoryState = {
    id: "compact-summary",
    ownerType: "actor",
    ownerId: owner.ownerId,
    name: owner.ownerName,
    contextUsageRatio: 0,
    messages: [
      {
        sequence: 1,
        type: "human",
        content: summary,
        createdAt: new Date().toISOString(),
      },
    ],
  };
  const leaks = findNameLeaks({ ...input, memories: [memory] });
  if (leaks.length > 0) {
    throw new GameError(
      "invalid_state",
      `压缩摘要包含观察者未认知的真名，已拒绝写回: ${leaks.length} 处`,
    );
  }
}

/**
 * 压缩任务也要带上世界设定：压缩结果会成为该主体后续所有回合的长期记忆，
 * 专名、称谓与人称必须在压缩后仍然一致。
 */
export function buildCompactionInput(
  owner: ResolvedOwner,
  transcript: string,
  world: CampaignContextWorld,
): string {
  const campaign = buildCampaignSettingBlock(world, {
    purpose: "压缩时保持专名、称谓与人称一致；不得据此新增记忆里没有的事实。",
  });

  return `# 记忆压缩

记忆主体：${owner.ownerName}
主体类型：${owner.ownerType}

${campaign}

以下只包含该主体本局可回忆的私有记忆。请把它们压缩成一段连续的私有记忆，保留对后续行动仍然重要的内容。

## 待压缩记忆

${transcript}`;
}

async function summarizeMemory(
  owner: ResolvedOwner,
  messages: readonly ChatMessage[],
  service: ChatCompletionService,
  world: CampaignContextWorld,
): Promise<string> {
  const transcript = getBufferString(messages.slice(1), { renderToolCalls: true });
  if (transcript.trim().length === 0) {
    throw new GameError("invalid_action", `没有可压缩记忆: ${owner.ownerName}`);
  }
  const result = await service.complete(
    new ChatCompletionRequest({
      label: `compact:${owner.ownerType}:${owner.ownerName}`,
      inputMessage: buildCompactionInput(owner, transcript, world),
      messages: [{ type: "system", content: COMPACT_SYSTEM_PROMPT }],
    }),
  );
  if (result.error) {
    throw new GameError("invalid_state", `记忆压缩请求失败: ${result.error.message}`);
  }
  const summary = result.content.trim();
  if (summary.length === 0) {
    throw new GameError("invalid_state", `记忆压缩返回空摘要: ${owner.ownerName}`);
  }
  return summary;
}

function validateMinRatio(minRatio: number | undefined): void {
  if (minRatio === undefined) {
    return;
  }
  if (!Number.isFinite(minRatio) || minRatio < 0 || minRatio > 1) {
    throw new GameError("invalid_action", "minRatio 必须在 0 到 1 之间");
  }
}

/**
 * 压缩后 memory 回到 [system, human] 的闭环；LLM 调用在事务外，事务内只做并发检查和落账。
 */
async function compactResolvedMemory(
  db: Database,
  gameId: string,
  world: CampaignContextWorld,
  owner: ResolvedOwner,
  options: CompactMemoryOptions,
  auditInput?: NameAuditInput,
): Promise<CompactMemoryResult> {
  validateMinRatio(options.minRatio);
  const memory = await loadAgentMemory(db, gameId, owner.ownerType, owner.ownerId);
  if (!memory) {
    throw new GameError("invalid_state", `记忆不存在: ${owner.ownerName}`);
  }
  if (memory.messages[0]?.type !== "system") {
    throw new GameError("invalid_state", `memory 第一条不是 system: ${owner.ownerName}`);
  }

  const beforeMessages = memory.messages.length;
  const contextUsageRatio = memory.row.contextUsageRatio;
  const base = {
    ownerType: owner.ownerType,
    ownerName: owner.ownerName,
    contextUsageRatio,
    beforeMessages,
    afterMessages: beforeMessages,
  };

  if (beforeMessages <= 1) {
    return { ...base, skipped: true, reason: "没有可压缩记忆" };
  }
  if (options.minRatio !== undefined && contextUsageRatio < options.minRatio) {
    return {
      ...base,
      skipped: true,
      reason: `contextUsageRatio ${contextUsageRatio.toFixed(4)} 低于阈值 ${options.minRatio}`,
    };
  }

  const summary = await summarizeMemory(owner, memory.messages, options.service, world);
  if (owner.ownerType === "actor") {
    if (!auditInput) {
      throw new GameError("invalid_state", `缺少 actor 名字审计输入: ${owner.ownerName}`);
    }
    assertActorSummaryKnown(auditInput, owner, summary);
  }
  const lastContent = memory.messages.at(-1)?.content;
  const beforeUpdatedAt = memory.row.updatedAt.getTime();

  await db.transaction(async (tx) => {
    const [game] = await tx.select().from(games).where(eq(games.id, gameId)).limit(1).for("update");
    if (!game) {
      throw new GameError("not_found", `游戏不存在: ${gameId}`);
    }
    const current = await loadAgentMemory(tx, gameId, owner.ownerType, owner.ownerId);
    if (!current) {
      throw new GameError("invalid_state", `记忆不存在: ${owner.ownerName}`);
    }
    if (
      current.messages.length !== beforeMessages ||
      current.row.updatedAt.getTime() !== beforeUpdatedAt ||
      current.messages.at(-1)?.content !== lastContent
    ) {
      throw new GameError("invalid_state", `记忆在压缩期间发生变化，请重试: ${owner.ownerName}`);
    }

    const compactedMessages = current.messages.slice(1);
    await tx
      .delete(agentMemoryMessages)
      .where(
        and(eq(agentMemoryMessages.memoryId, current.row.id), gte(agentMemoryMessages.sequence, 2)),
      );
    await appendMemoryMessages(tx, current.row.id, [
      {
        type: "human",
        content: `# 本局记忆\n\n${summary}`,
        metadata: {
          kind: MEMORY_KINDS.compactedMemory,
          /** 被这次 compact 吸收的旧消息；内含更早的 compact 节点，形成可回溯树。 */
          compactedMessages,
          compactedMessageCount: compactedMessages.length,
          contextUsageRatio,
          compactedAt: new Date().toISOString(),
        },
      },
    ]);
    await tx
      .update(agentMemories)
      .set({ contextUsageRatio: 0, updatedAt: new Date() })
      .where(eq(agentMemories.id, current.row.id));
  });

  return {
    ...base,
    skipped: false,
    afterMessages: 2,
    summary,
  };
}

export async function compactMemory(
  db: Database,
  gameRef: string,
  target: CompactTarget,
  options: CompactMemoryOptions,
): Promise<CompactMemoryResult> {
  const state = await getGameState(db, gameRef);
  const owner = resolveTarget(state, target);
  const auditInput =
    owner.ownerType === "actor" ? await loadNameAuditInput(db, state.game.id) : undefined;
  return compactResolvedMemory(db, state.game.id, state.world, owner, options, auditInput);
}

export async function compactAllMemories(
  db: Database,
  gameRef: string,
  options: CompactMemoryOptions,
): Promise<CompactMemoryResult[]> {
  const state = await getGameState(db, gameRef);
  const auditInput = await loadNameAuditInput(db, state.game.id);
  const results: CompactMemoryResult[] = [];
  for (const owner of resolveAllOwners(state)) {
    results.push(
      await compactResolvedMemory(db, state.game.id, state.world, owner, options, auditInput),
    );
  }
  return results;
}
