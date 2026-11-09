import { ChatCompletionRequest, type ChatCompletionService, type ChatMessage } from "../../llm";
import { GameError } from "../errors";
import type { WorldConstitution } from "../world-function";
import { buildCompactionInput, buildCompactSystemPrompt, renderTranscript } from "./prompt";
import type { ResolvedOwner } from "./types";

/**
 * 跑一次压缩推理：输入是本局记忆的转写，输出是一段连续的私有记忆正文。
 *
 * 第一条 system 不参与压缩（它是宪法），因此转写从第二条开始。
 */

export async function summarizeMemory(
  owner: ResolvedOwner,
  messages: readonly ChatMessage[],
  service: ChatCompletionService,
  world: WorldConstitution,
): Promise<string> {
  const transcript = renderTranscript(messages.slice(1));
  if (transcript.trim().length === 0) {
    throw new GameError("invalid_action", `没有可压缩记忆: ${owner.ownerName}`);
  }
  const result = await service.complete(
    new ChatCompletionRequest({
      label: `compact:${owner.ownerType}:${owner.ownerName}`,
      inputMessage: buildCompactionInput(owner, transcript),
      messages: [{ type: "system", content: buildCompactSystemPrompt(world) }],
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
