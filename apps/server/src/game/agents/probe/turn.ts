import type { Database } from "../../../db/pool";
import { ChatCompletionRequest, type ChatMessage } from "../../../llm";
import { findActorByName } from "../../actor-state";
import { GameError } from "../../errors";
import { getGameStateSlice } from "../../game-state";
import type { GameStateSlice } from "../../kernel/types";
import { loadAgentMemory } from "../../memory";
import { findStage } from "../../stage-state";
import { buildProbeInput } from "./prompt";
import type { ProbeOptions, ProbeResult, ProbeTarget } from "./types";

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

  const target = await loadProbeTarget(db, state, options.target);
  const result = await options.service.complete(
    new ChatCompletionRequest({
      label: `probe:${options.target.type}:${target.name}`,
      inputMessage: buildProbeInput(question),
      messages: [...target.messages],
    }),
  );
  if (result.error) {
    throw new GameError("invalid_state", `探针请求失败: ${result.error.message}`);
  }

  return {
    targetType: options.target.type,
    targetName: target.name,
    answer: result.content,
    finishReason: result.finishReason,
  };
}

/** 定位被问的实体，取它自己的 memory；两种目标的差别只在怎么找到它。 */
async function loadProbeTarget(
  db: Database,
  state: GameStateSlice,
  target: ProbeTarget,
): Promise<{ name: string; messages: ChatMessage[] }> {
  const { id, name } =
    target.type === "actor"
      ? findActorByName(state, target.actorRef).actor
      : findStage(state, target.stageRef);
  const memory = await loadAgentMemory(db, state.game.id, target.type, id);
  if (!memory) {
    throw new GameError("invalid_state", `${target.type} 缺少 memory: ${name}`);
  }
  return { name, messages: memory.messages };
}
