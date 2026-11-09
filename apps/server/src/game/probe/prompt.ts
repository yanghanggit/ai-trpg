/**
 * 探针的提示词：先声明这是一次只读问答，再把问题原样附在后面。
 *
 * 探针复用目标 agent 自己的 system prompt 与 memory（在 `turn.ts` 里装配），
 * 所以这里不重复任何设定，只负责把「本轮不是回合」说清楚。
 */
export function buildProbeInput(question: string): string {
  return `# 探针模式

这是一次只读探针，不是行动回合，不会改变游戏状态。

只根据你的 system prompt 与 memory 回答；不要假设任何未写入 memory 的当前状态，不要调用工具、提交计划或执行行动。

# 探针问题

${question}`;
}
