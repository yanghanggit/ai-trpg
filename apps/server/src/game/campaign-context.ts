/**
 * 运行时 agent 的世界设定注入。
 *
 * 分层与 `dialogue-audit` 一致：system prompt 只放固定的职责与判定口径，
 * 每局不同的世界设定作为**任务上下文**下发——它是约束产出的数据，不是系统策略。
 * 凡会产出世界面文本、或会改写长期记忆的运行时 agent 都必须经过这里：
 * 掉落、词缀、故事整理、记忆压缩都在此列；带 memory 的 actor / stage / world /
 * 外观 / 探针已由各自的 system prompt 携带设定，不重复注入。
 *
 * 内容侧只提供文本，不认识具体 agent；这里也不写任何题材专名。
 */
export type CampaignContextWorld = {
  name: string;
  campaignSetting: string;
};

export type CampaignSettingBlockOptions = {
  /** 这段设定在本任务里的用途；写一句可执行的话，避免模型把它当成剧情事实来源。 */
  purpose: string;
};

/** 组装「世界设定」任务块：世界名 + 战役设定 + 本任务的用途说明。 */
export function buildCampaignSettingBlock(
  world: CampaignContextWorld,
  options: CampaignSettingBlockOptions,
): string {
  return `## 世界设定

世界：${world.name}

${world.campaignSetting}

以上设定只用于约束本任务产出的用词、风格与世界边界：${options.purpose}`;
}
