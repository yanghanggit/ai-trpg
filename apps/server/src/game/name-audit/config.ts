import { MEMORY_KINDS } from "../constants";

/**
 * 审计的开关与口径。
 *
 * 默认跳过 system prompt：campaignSetting / profile 是内容层设定，可能刻意使用
 * 普通名词或历史人物名；需要连内容一起检查时显式关掉 `skipKinds`。
 */

export const ENV_NAME_AUDIT = "TRPG_AUDIT_NAMES";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
export const DEFAULT_SKIP_KINDS = [MEMORY_KINDS.actorSystemPrompt];
export const MAX_RUNTIME_TRACE_EVENTS = 20;

/** 回合级审计只看最近的增量；留一点时钟余量，避免 DB 与应用时钟的毫秒差漏掉消息。 */
const RUNTIME_LOOKBACK_MS = 2000;

/** `TRPG_AUDIT_NAMES=1/true/yes/on` 时打开回合级审计。 */
export function nameAuditEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[ENV_NAME_AUDIT]?.trim().toLowerCase();
  return raw !== undefined && TRUE_VALUES.has(raw);
}

/** 回合级的 `since`：留出 DB 与应用时钟的毫秒差。 */
export function nameAuditSince(now: Date = new Date()): Date {
  return new Date(now.getTime() - RUNTIME_LOOKBACK_MS);
}
