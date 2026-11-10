import type { Database } from "../../db/pool";
import type { MemoryTarget } from "../bypass";
import { DEFAULT_APPEARANCE_MAX_ROUNDS } from "../default-rounds";
import { writeAppearanceSnapshot } from "./record";
import { renderAppearance } from "./render";
import type { AppearanceOptions, AppearanceOutcome, AppearanceTask } from "./types";

/**
 * 外观任务的骨架：生成 → 落账（可选广播）。
 *
 * 只做调度，不带业务：任务文本与上下文由调用方给，广播与否由调用方定。
 * 生成失败即没有落账，当前外观保持不变；轮数预算也只在这里兜底。
 */
export async function runAppearanceTask(
  db: Database,
  target: MemoryTarget,
  task: AppearanceTask,
  options: AppearanceOptions,
): Promise<AppearanceOutcome> {
  const maxRounds = options.maxRounds ?? DEFAULT_APPEARANCE_MAX_ROUNDS;
  const rendered = await renderAppearance(
    target,
    { inputMessage: task.inputMessage, maxRounds },
    options,
  );
  if (rendered.appearance === null) {
    return {
      ok: false,
      appearance: null,
      ...(rendered.reason ? { reason: rendered.reason } : {}),
    };
  }

  await writeAppearanceSnapshot(db, {
    target,
    appearance: rendered.appearance,
    inputMessage: task.inputMessage,
    maxRounds,
    context: task.context,
    notify: task.notify,
    ...(options.trace ? { trace: options.trace } : {}),
  });
  return { ok: true, appearance: rendered.appearance };
}
