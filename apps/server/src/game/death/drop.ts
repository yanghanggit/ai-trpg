import { randomUUID } from "node:crypto";
import type { Database } from "../../db/pool";
import { DEFAULT_ERROR_RETRIES, loopErrorReason } from "../../llm";
import { agentLoop } from "../../llm/agent-loop";
import type { ChatCompletionService } from "../../llm/protocol";
import { allActors, findActorByName } from "../actor-state";
import { bumpGameVersion } from "../apply/messages";
import { DEFAULT_DROP_MAX_ROUNDS } from "../default-rounds";
import { GameError } from "../errors";
import { appendStageMemory } from "../observations";
import { lockGameRow } from "../persistence/games";
import { addActorMaterials, type MaterialDrop } from "../persistence/items";
import { getGameStateSlice } from "../read/game-state";
import type { ActorState, StageState, WorldState } from "../types";
import { worldFunctionPrompt } from "../world-function";
import { buildDropMaterialsTool, parseDrops } from "./drop-materials";

export type DropPhaseOptions = {
  service: ChatCompletionService;
  maxRounds?: number;
  logger?: Parameters<typeof agentLoop>[0]["logger"];
  /** 所属回合的轨迹；有值则把这次推理并入该回合。 */
  trace?: Parameters<typeof agentLoop>[0]["trace"];
};

export type DropPhaseResult = {
  ok: boolean;
  /** 真正留在尸体上的材料名；模型返回空数组时也是 `ok`。 */
  dropped: string[];
  /** 没生成时的原因：loop 失败，或模型没调用提交工具。 */
  reason?: string;
};

/**
 * 掉落裁决的宪法：建局时装配好的完整文本。
 *
 * 世界设定是任务上下文：材料会变成公共物品名并被玩家反复引用，必须使用该世界
 * 自己的材质、工艺与叫法，不能靠模型的世界外常识补全。
 */
function buildDropSystemPrompt(world: WorldState): string {
  return worldFunctionPrompt(world, "drops");
}

/**
 * 掉落推理的输入：这一轮要模型看什么。
 *
 * 掉落只看得到尸体本身与所在场景；不注入死者记忆，掉落必须是外部可观察的事实。
 * 外观小节报「此刻的可见外观」而不是「尸体外观」：尸体外观是至多一次的后置推理，
 * 没跑成时这里就是生前最后一条记录，不能向模型承诺它一定是尸体描写。
 */
export function buildDropInput(actor: ActorState, stage: StageState): string {
  return `# 尸体掉落

${actor.name}刚刚死亡。

## 形态

${actor.signature.form}

## 此刻的可见外观

${actor.appearance.text}

## 所在场景

${stage.name}：${stage.environment}

# 本轮任务

判断这具尸体在被搜刮之前留下什么可以被别人捡走的材料。只写尸体本身产生的、可以被别人搜走的实体残留，材质不限；不写它穿戴的东西。

材料名与描述不得含角色名或编号引用。

不写它原本持有的物品；那些留在它的背包里，不走掉落。不写心理、名字与规则，不解释推理过程。没有合理产物就提交空数组。完成后调用 drop_materials 提交。`;
}

/**
 * 掉落阶段：跑一次推理，把尸体留下的材料写进它自己的背包。
 *
 * 只见尸体与所在场景；落账与场景记忆在同一个事务里，事务外只有 LLM 调用。
 * 幂等由调用方的死亡认领保证：一次死亡只掉一次，这里不另设标记。
 */
export async function runDropPhase(
  db: Database,
  gameRef: string,
  actorRef: string,
  options: DropPhaseOptions,
): Promise<DropPhaseResult> {
  const state = await getGameStateSlice(db, gameRef);
  if (state.game.status !== "active") {
    throw new GameError("invalid_state", `游戏已结束: ${state.game.status}`);
  }
  const { actor, stage } = findActorByName(state, actorRef);

  const tool = buildDropMaterialsTool();
  // 模型提交的掉落；`undefined` 是「还没提交」，空数组是合法结果。
  let materials: MaterialDrop[] | undefined;
  const loop = await agentLoop({
    name: actor.name,
    inputMessage: buildDropInput(actor, stage),
    messages: [{ type: "system", content: buildDropSystemPrompt(state.world) }],
    mutateMessages: false,
    tools: [tool],
    handlers: {
      [tool.function.name]: (args) => {
        if (materials !== undefined) {
          throw new GameError("invalid_action", "掉落已提交");
        }
        materials = parseDrops(
          args,
          allActors(state).map((entry) => entry.actor.name),
        );
        return "掉落已提交";
      },
    },
    terminalTools: [tool],
    service: options.service,
    maxRounds: options.maxRounds ?? DEFAULT_DROP_MAX_ROUNDS,
    errorRetries: DEFAULT_ERROR_RETRIES,
    loopId: randomUUID(),
    ...(options.logger ? { logger: options.logger } : {}),
    ...(options.trace ? { trace: options.trace } : {}),
  });

  if (!loop.success || materials === undefined) {
    const reason = loop.success
      ? "模型未调用 drop_materials 提交掉落"
      : (loopErrorReason(loop) ?? "推理未完成");
    return { ok: false, dropped: [], reason };
  }
  const dropped = materials;
  const now = new Date();

  const written = await db.transaction(async (tx) => {
    const game = await lockGameRow(tx, state.game.id);
    if (!game) {
      throw new GameError("not_found", `游戏不存在: ${state.game.id}`);
    }
    if (game.status !== "active") {
      throw new GameError("invalid_state", `游戏已结束，不能掉落材料: ${game.status}`);
    }
    const settled = await addActorMaterials(tx, state.game.id, actor.id, actor.name, dropped);
    if (settled.written.length > 0) {
      const list = dropped
        .filter((material) => settled.written.includes(material.name))
        .map((material) => `${material.name} ×${material.count}`)
        .join("、");
      await appendStageMemory(
        tx,
        state.game.id,
        stage.id,
        `# 尸体遗留\n${actor.name}的尸体上多了：${list}。`,
        { eventKind: "drop", targetActorId: actor.id },
        options.trace,
      );
    }
    await bumpGameVersion(tx, state.game.id, now);
    return settled.written;
  });

  return { ok: true, dropped: written };
}
