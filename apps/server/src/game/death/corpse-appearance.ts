import type { Database } from "../../db/pool";
import {
  type AppearanceOptions,
  type AppearanceOutcome,
  loadAppearanceTarget,
  renderWorn,
  runAppearanceTask,
  VISIBILITY_RULES,
  wornForAppearance,
} from "../appearance";
import type { ActorState, AppearanceWornItem } from "../types";

export type CorpseAppearanceInput = {
  inputMessage: string;
  form: string;
  worn: AppearanceWornItem[];
  base: string;
};

/**
 * `death`：以刷新前的当前外观为底，把「已经死亡」翻译成看得见的样子。
 *
 * 「死亡」「尸体」是跨题材通用的状态词，可以留在引擎；材质与痕迹不点名：任务只给
 * 姿态、表面与结构三个维度，不说穿戴掉落在哪、也不说周围留下什么——那属于引擎没有
 * 的机制，写进提示词等于教模型编造。见 docs/data-driven.md。
 */
export function buildCorpseAppearanceInput(actor: ActorState, base: string): CorpseAppearanceInput {
  const worn = wornForAppearance(actor);
  const inputMessage = `# 尸体外观

你已经死亡。以你此刻的外观为底，用第三人称写出尸体现在的样子。

## 形态

${actor.signature.form}

## 你此刻的外观

${base}

## 你身上的穿戴

${renderWorn(worn)}

# 本轮任务

写出尸体此刻的样子：在现有外观上体现死亡带来的变化。

- 记忆里若有造成这次死亡的可见事实，用它；没有就不要猜。
- 只动姿态、表面与结构。
- 不加原本没有的东西；形态与穿戴不变。

${VISIBILITY_RULES}`;
  return { inputMessage, form: actor.signature.form, worn, base };
}

/**
 * 死者的外观：以刷新前的当前外观为底，叠加死亡痕迹。
 *
 * 只由死亡阶段调用；「只跑一次」由调用方的收尾标记保证，所以失败不补账——宣布成功后
 * 这具尸体不会再被扫描到，生前最后一条记录就留在那里。不写变化事件：宣布阶段已经
 * 通知过全场与死者自己，再贴一条只是同一个事实说两遍。
 */
export async function refreshCorpseAppearance(
  db: Database,
  gameRef: string,
  actorRef: string,
  options: AppearanceOptions,
): Promise<AppearanceOutcome> {
  const target = await loadAppearanceTarget(db, gameRef, actorRef);
  const input = buildCorpseAppearanceInput(target.actor, target.actor.appearance.text);
  return runAppearanceTask(
    db,
    target,
    {
      inputMessage: input.inputMessage,
      context: {
        task: "death",
        form: input.form,
        worn: input.worn,
        base: input.base,
        contentVersion: target.state.game.contentVersion,
      },
      notify: false,
    },
    options,
  );
}
