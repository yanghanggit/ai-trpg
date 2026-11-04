/**
 * 世界职能的宪法：内容层定档，运行时直接读。
 *
 * 文本与装配都在 `seeds/`（一个 agent 一个文件），建局时随世界存库；
 * 这里只提供运行时读取，不再拼接任何片段。
 */

import type { WorldFunctionAgent, WorldFunctionAgents, WorldFunctionType } from "./types";

/** 世界宪法：一局的战役设定、全局规则与定档好的世界职能 agent。 */
export type WorldConstitution = {
  name: string;
  campaignSetting: string;
  globalRules: string;
  functionAgents: WorldFunctionAgents;
};

/** 某个世界职能 agent；建局前已定档，运行时直接取用。 */
export function worldFunctionAgent(
  world: WorldConstitution,
  fn: WorldFunctionType,
): WorldFunctionAgent {
  const agent = world.functionAgents.find((candidate) => candidate.fn === fn);
  if (agent === undefined || agent.systemPrompt.trim().length === 0) {
    throw new Error(`缺少世界职能 agent: ${world.name} / ${fn}`);
  }
  return agent;
}
