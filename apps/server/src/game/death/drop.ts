import type { Database } from "../../db/pool";
import { bumpGameVersion } from "../apply/messages";
import { loadMemoryTarget, type MemoryRenderOptions, renderWithMemory } from "../bypass";
import { DEFAULT_DROP_MAX_ROUNDS } from "../default-rounds";
import { GameError } from "../errors";
import { lockGameRow } from "../persistence/games";
import { addActorMaterials, type MaterialDrop } from "../persistence/items";
import type { ActorState, StageState } from "../types";
import { buildDropMaterialsTool, parseDrops } from "./drop-materials";

/** 掉落的依赖：旁路那份依赖，另加这一任务的轮数预算。 */
export type DropOptions = MemoryRenderOptions & { maxRounds?: number };

export type DropOutcome = {
  ok: boolean;
  /** 真正留在尸体上的材料名；模型返回空数组时也是 `ok`。 */
  dropped: string[];
  /** 没生成时的原因：loop 失败，或模型没调用提交工具。 */
  reason?: string;
};

/**
 * 掉落推理的输入：这一轮要模型看什么。
 *
 * 掉落是旁路：宪法与过往都来自死者自己的记忆，任务层只补当下的状态——形态、此刻的
 * 可见外观、所在场景。场景可以给（尸体躺在水里和躺在灰里有差别），因为掉落是一次性
 * 产物；外观不注入场景，是因为外观会随环境反复漂移、没有稳定终点。
 *
 * 外观小节报「此刻的可见外观」而不是「尸体外观」：尸体外观是至多一次的后置推理，
 * 没跑成时这里就是生前最后一条记录，不能向模型承诺它一定是尸体描写。
 */
export function buildDropInput(actor: ActorState, stage: StageState): string {
  return `# 尸体掉落

你已经死亡。

## 形态

${actor.signature.form}

## 你此刻的可见外观

${actor.appearance.text}

## 你所在场景

${stage.name}：${stage.environment}

# 本轮任务

判断你这具尸体留下什么可以被别人捡走的材料。只写你身上产生的、别人能搜走拿在手上的实体残留，材质不限；不写你穿戴的东西。

材料名与描述是别人能看见的公共标签：不写只有你自己知道的秘密、身份与来历，不含角色名或编号引用。

不写你原本持有的物品；那些留在你的背包里，不走掉落。不写心理与规则，不解释推理过程。没有合理产物就提交空数组。完成后调用 drop_materials 提交。`;
}

/**
 * 尸体掉落：借死者的记忆跑一次推理，把留下的材料写进它自己的背包。
 *
 * 旁路只写状态、不写记忆：材料是运行时的派生产物，没有观察者被告知这一步，
 * 别人要知道尸体上有什么，就得搜（`loot` / `inspect`）；stage 本来就全知在场
 * actor 的携带物，也不需要补一条事件。
 *
 * 幂等由调用方的死亡认领保证：一次死亡只掉一次，这里不另设标记。
 */
export async function dropCorpseMaterials(
  db: Database,
  gameRef: string,
  actorRef: string,
  options: DropOptions,
): Promise<DropOutcome> {
  const target = await loadMemoryTarget(db, gameRef, actorRef);
  const { actor } = target;

  const rendered = await renderWithMemory<MaterialDrop[]>(
    target,
    {
      inputMessage: buildDropInput(actor, target.stage),
      maxRounds: options.maxRounds ?? DEFAULT_DROP_MAX_ROUNDS,
      tool: buildDropMaterialsTool(),
      parse: (args) => parseDrops(args, target.actorNames),
      label: "掉落",
    },
    options,
  );
  if (rendered.value === null) {
    return {
      ok: false,
      dropped: [],
      ...(rendered.reason ? { reason: rendered.reason } : {}),
    };
  }

  const dropped = rendered.value;
  const now = new Date();
  const written = await db.transaction(async (tx) => {
    // 推理期间游戏可能已经结束，落账前再确认一次。
    const game = await lockGameRow(tx, target.state.game.id);
    if (!game) {
      throw new GameError("not_found", `游戏不存在: ${target.state.game.id}`);
    }
    if (game.status !== "active") {
      throw new GameError("invalid_state", `游戏已结束，不能掉落材料: ${game.status}`);
    }
    const settled = await addActorMaterials(
      tx,
      target.state.game.id,
      actor.id,
      actor.name,
      dropped,
    );
    await bumpGameVersion(tx, target.state.game.id, now);
    return settled.written;
  });

  return { ok: true, dropped: written };
}
