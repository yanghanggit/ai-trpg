import type { Database } from "../../../db/pool";
import { ChatCompletionRequest } from "../../../llm";
import { GameError } from "../../errors";
import { getGameStateSlice } from "../../game-state";
import { loadAgentMemory, resolveMemoryOwner } from "../../memory";
import { buildProbeInput } from "./prompt";
import type { ProbeOptions, ProbeResult } from "./types";

/**
 * 只读探针：用目标 agent 自己的 system prompt 与 memory 回答一句话。
 *
 * 不写 memory、不产生公共事件、不改变游戏状态，也不提交行动计划——它只是把
 * 「这个 agent 现在知道什么」问出来，所以消息历史原样带走，不做任何裁剪。
 */
export async function runProbe(
  db: Database,
  gameRef: string,
  options: ProbeOptions,
): Promise<ProbeResult> {
  const state = await getGameStateSlice(db, gameRef);
  const question = options.message.trim();
  if (question.length === 0) {
    throw new GameError("invalid_action", "探针问题不能为空");
  }

  // 定位复用记忆那一条：谁有记忆、名字怎么认，只有 owner.ts 说了算。
  const owner = resolveMemoryOwner(
    state,
    options.owner.owner,
    options.owner.owner === "world" ? undefined : options.owner.name,
  );
  const memory = await loadAgentMemory(db, state.game.id, owner.ownerType, owner.ownerId);
  if (!memory) {
    throw new GameError("invalid_state", `${owner.ownerType} 缺少 memory: ${owner.name}`);
  }

  const result = await options.service.complete(
    new ChatCompletionRequest({
      label: `probe:${owner.ownerType}:${owner.name}`,
      inputMessage: buildProbeInput(question),
      messages: [...memory.messages],
    }),
  );
  if (result.error) {
    throw new GameError("invalid_state", `探针请求失败: ${result.error.message}`);
  }

  return {
    targetType: owner.ownerType,
    targetName: owner.name,
    answer: result.content,
    finishReason: result.finishReason,
  };
}
