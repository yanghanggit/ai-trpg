import type { Database } from "../../../db/pool";
import { loadMemoryTarget } from "../bypass";
import { runAppearanceTask } from "./compose";
import { buildAppearanceUpdateInput } from "./prompt";
import type { AppearanceOptions, AppearanceOutcome } from "./types";

/**
 * 活人的外观：按形态 + 穿戴 + 记忆重新生成，覆盖当前记录，并广播这次可见变化。
 *
 * 只更新运行时外观，不改 system prompt：签名上的 `form` 才是稳定身份。写回后把这次
 * 可见变化写进记忆：自己一条、同舞台他人各一条。
 */
export async function updateAppearance(
  db: Database,
  gameRef: string,
  actorRef: string,
  options: AppearanceOptions,
): Promise<AppearanceOutcome> {
  const target = await loadMemoryTarget(db, gameRef, actorRef);
  const input = buildAppearanceUpdateInput(target.actor);
  return runAppearanceTask(
    db,
    target,
    {
      inputMessage: input.inputMessage,
      context: {
        task: "update",
        form: input.form,
        worn: input.worn,
        contentVersion: target.state.game.contentVersion,
      },
      notify: true,
    },
    options,
  );
}

/**
 * 维护性重推：任务与 `updateAppearance` 相同，但不写变化事件。
 *
 * 重推的输入没变、结果也不该变，它不是世界里发生的事实；往记忆里贴一条「外观变了」
 * 只会让下一次回合读到假事件。批量维护走这里。
 */
export async function rebuildAppearance(
  db: Database,
  gameRef: string,
  actorRef: string,
  options: AppearanceOptions,
): Promise<AppearanceOutcome> {
  const target = await loadMemoryTarget(db, gameRef, actorRef);
  const input = buildAppearanceUpdateInput(target.actor);
  return runAppearanceTask(
    db,
    target,
    {
      inputMessage: input.inputMessage,
      context: {
        task: "update",
        form: input.form,
        worn: input.worn,
        contentVersion: target.state.game.contentVersion,
      },
      notify: false,
    },
    options,
  );
}
