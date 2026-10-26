import type { Database } from "../db/pool";
import { ChatCompletionRequest, type ChatCompletionService, type ChatMessage } from "../llm";
import { findActorWithStage, findStage } from "./actors";
import { GameError } from "./errors";
import { loadAgentMemory } from "./memory";
import { getGameState } from "./service";

export type ProbeTarget = { type: "actor"; actorRef: string } | { type: "stage"; stageRef: string };

export type ProbeOptions = {
  service: ChatCompletionService;
  target: ProbeTarget;
  message: string;
};

export type ProbeResult = {
  targetType: ProbeTarget["type"];
  targetName: string;
  answer: string;
  finishReason: string;
};

function buildProbeInput(question: string): string {
  return `# 探针模式

这是一次只读探针，不是行动回合，不会改变游戏状态。

只根据你的 system prompt 与 memory 回答；不要假设任何未写入 memory 的当前状态，不要调用工具、提交计划或执行行动。

# 探针问题

${question}`;
}

/**
 * 只读：不写 memory、不产生公共事件、不改变游戏状态，也不提交行动计划。
 */
export async function runProbe(
  db: Database,
  gameRef: string,
  options: ProbeOptions,
): Promise<ProbeResult> {
  const state = await getGameState(db, gameRef);
  const question = options.message.trim();
  if (question.length === 0) {
    throw new GameError("invalid_action", "探针问题不能为空");
  }

  let targetName: string;
  let messages: ChatMessage[];

  switch (options.target.type) {
    case "actor": {
      const current = findActorWithStage(state, options.target.actorRef);
      const memory = await loadAgentMemory(db, state.game.id, "actor", current.actor.id);
      if (!memory) {
        throw new GameError("invalid_state", `actor 缺少 memory: ${current.actor.name}`);
      }
      targetName = current.actor.name;
      messages = memory.messages;
      break;
    }
    case "stage": {
      const stage = findStage(state, options.target.stageRef);
      const memory = await loadAgentMemory(db, state.game.id, "stage", stage.id);
      if (!memory) {
        throw new GameError("invalid_state", `stage 缺少 memory: ${stage.name}`);
      }
      targetName = stage.name;
      messages = memory.messages;
      break;
    }
  }

  const result = await options.service.complete(
    new ChatCompletionRequest({
      label: `probe:${options.target.type}:${targetName}`,
      inputMessage: buildProbeInput(question),
      messages: [...messages],
    }),
  );
  if (result.error) {
    throw new GameError("invalid_state", `探针请求失败: ${result.error.message}`);
  }

  return {
    targetType: options.target.type,
    targetName,
    answer: result.content,
    finishReason: result.finishReason,
  };
}
