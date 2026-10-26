import { randomUUID } from "node:crypto";
import type { Database } from "../db/pool";
import { agentLoop } from "../llm/agent-loop";
import type { ChatCompletionService } from "../llm/protocol";
import type { ToolDefinition } from "../llm/types";
import { findActor } from "./actors";
import { bumpGameVersion } from "./apply/messages";
import { formatBaseBody } from "./body";
import {
  DEFAULT_DROP_MAX_ROUNDS,
  MAX_DROP_MATERIALS,
  MAX_MATERIAL_COUNT,
  MAX_MATERIAL_DESCRIPTION_LENGTH,
  MAX_MATERIAL_NAME_LENGTH,
} from "./constants";
import { GameError } from "./errors";
import { appendStageEvent } from "./observations";
import { lockGameRow } from "./persistence/games";
import { addActorMaterials, type MaterialDrop } from "./persistence/items";
import { getGameState } from "./service";
import type { ActorState, GameState, StageState } from "./types";

export type DropTurnOptions = {
  service: ChatCompletionService;
  maxRounds?: number;
  logger?: Parameters<typeof agentLoop>[0]["logger"];
};

export type DropTurnResult = {
  ok: boolean;
  /** 真正留在尸体上的材料名；模型返回空数组时也是 `ok`。 */
  dropped: string[];
  state: GameState;
};

/** 掉落推理只有这一个终止工具。 */
export function buildDropMaterialsTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "drop_materials",
      description: `提交尸体留下的材料，最多 ${MAX_DROP_MATERIALS} 条。只写尸体本身产生的物理产物：毛皮、牙、骨、鳞、血、绒、残渣这类可以被别人搜走的东西。不写它生前持有的武器、钥匙、信件或其它剧情物品——那些属于尸体原有的背包，不靠掉落生成。材料会留在尸体上。没有合理产物就提交空数组。必须是本轮最后一个动作。`,
      parameters: {
        type: "object",
        properties: {
          items: {
            type: "array",
            description: `材料清单，最多 ${MAX_DROP_MATERIALS} 条；没有就提交空数组`,
            items: {
              type: "object",
              properties: {
                name: {
                  type: "string",
                  description: `材料名，${MAX_MATERIAL_NAME_LENGTH} 个字符以内，如“风干的厚皮”`,
                },
                description: {
                  type: "string",
                  description: `第三人称可见的描述：颜色、质地、大小、残缺程度，${MAX_MATERIAL_DESCRIPTION_LENGTH} 个字符以内`,
                },
                count: {
                  type: "integer",
                  description: `数量，1 到 ${MAX_MATERIAL_COUNT}，省略按 1`,
                },
              },
              required: ["name", "description"],
            },
          },
        },
        required: ["items"],
      },
    },
  };
}

/** 掉落物只能是非空、不超长的材料；任一条不合法整批拒绝，不静默截断。 */
export function parseDrops(args: Record<string, unknown>): MaterialDrop[] {
  const items = args.items;
  if (!Array.isArray(items)) {
    throw new GameError("invalid_action", "drop_materials 需要 items 数组");
  }
  if (items.length > MAX_DROP_MATERIALS) {
    throw new GameError("invalid_action", `一次最多掉落 ${MAX_DROP_MATERIALS} 条材料`);
  }

  const names = new Set<string>();
  return items.map((raw) => {
    if (typeof raw !== "object" || raw === null) {
      throw new GameError("invalid_action", "每条掉落都需要 name 与 description");
    }
    const value = raw as Record<string, unknown>;
    const name = typeof value.name === "string" ? value.name.trim() : "";
    const description = typeof value.description === "string" ? value.description.trim() : "";
    const count = value.count === undefined ? 1 : value.count;

    if (name.length === 0 || name.length > MAX_MATERIAL_NAME_LENGTH) {
      throw new GameError(
        "invalid_action",
        `材料名不能为空且不超过 ${MAX_MATERIAL_NAME_LENGTH} 个字符: ${name}`,
      );
    }
    if (names.has(name)) {
      throw new GameError("invalid_action", `同一次掉落里材料名重复: ${name}`);
    }
    names.add(name);
    if (description.length === 0 || description.length > MAX_MATERIAL_DESCRIPTION_LENGTH) {
      throw new GameError(
        "invalid_action",
        `材料描述不能为空且不超过 ${MAX_MATERIAL_DESCRIPTION_LENGTH} 个字符: ${name}`,
      );
    }
    if (
      typeof count !== "number" ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > MAX_MATERIAL_COUNT
    ) {
      throw new GameError("invalid_action", `材料数量必须是 1 到 ${MAX_MATERIAL_COUNT} 的整数`);
    }
    return { name, description, count };
  });
}

/** 掉落只看得到尸体本身与所在场景；不注入死者记忆，掉落必须是外部可观察的事实。 */
export function buildDropObservation(actor: ActorState, stage: StageState): string {
  return `# 尸体掉落

${actor.name}刚刚死亡。

## 种族与裸体形态

${formatBaseBody(actor.baseBody)}

## 尸体外观

${actor.appearance}

## 所在场景

${stage.name}：${stage.environment}

# 本轮任务

判断这具尸体在被搜刮之前留下什么可以被别人捡走的材料。只写尸体本身产生的物理产物：毛皮、牙、骨、鳞、血、绒、残渣、衣物以外的碎片。

不写它生前持有的武器、钥匙、信件或任何剧情物品；那些留在尸体背包里，不走掉落。不写心理、名字与规则，不解释推理过程。没有合理产物就提交空数组。完成后调用 drop_materials 提交。`;
}

/**
 * 掉落阶段：给一具刚宣布死亡的尸体生成材料，写进尸体自己的背包。
 *
 * 只在死亡阶段对新宣布的死者调用，所以不需要额外的幂等标记。
 */
export async function runDropTurn(
  db: Database,
  gameRef: string,
  actorRef: string,
  options: DropTurnOptions,
): Promise<DropTurnResult> {
  const state = await getGameState(db, gameRef);
  if (state.game.status !== "active") {
    throw new GameError("invalid_state", `游戏已结束: ${state.game.status}`);
  }
  const actor = findActor(state, actorRef);
  const stage = state.world.stages.find((candidate) =>
    candidate.actors.some((member) => member.id === actor.id),
  );
  if (!stage) {
    throw new GameError("invalid_state", `actor 不属于任何场景: ${actor.name}`);
  }

  const tool = buildDropMaterialsTool();
  const submitted: { materials: MaterialDrop[] | null } = { materials: null };
  const loop = await agentLoop({
    name: actor.name,
    inputMessage: buildDropObservation(actor, stage),
    messages: [],
    mutateMessages: false,
    tools: [tool],
    handlers: {
      [tool.function.name]: (args) => {
        if (submitted.materials !== null) {
          throw new GameError("invalid_action", "掉落已提交");
        }
        submitted.materials = parseDrops(args);
        return "掉落已提交";
      },
    },
    terminalTools: [tool],
    service: options.service,
    maxRounds: options.maxRounds ?? DEFAULT_DROP_MAX_ROUNDS,
    loopId: randomUUID(),
    ...(options.logger ? { logger: options.logger } : {}),
  });

  if (!loop.success || submitted.materials === null) {
    return { ok: false, dropped: [], state: await getGameState(db, state.game.id) };
  }
  const dropped = submitted.materials;
  let written: string[] = [];

  const now = new Date();
  await db.transaction(async (tx) => {
    const game = await lockGameRow(tx, state.game.id);
    if (!game) {
      throw new GameError("not_found", `游戏不存在: ${state.game.id}`);
    }
    if (game.status !== "active") {
      throw new GameError("invalid_state", `游戏已结束，不能掉落材料: ${game.status}`);
    }
    ({ written } = await addActorMaterials(tx, actor.id, dropped));
    if (written.length > 0) {
      const list = dropped
        .filter((material) => written.includes(material.name))
        .map((material) => `${material.name} ×${material.count}`)
        .join("、");
      await appendStageEvent(
        tx,
        state.game.id,
        stage.id,
        `# 尸体遗留\n${actor.name}的尸体上多了：${list}。`,
        { eventKind: "drop", targetActorId: actor.id },
      );
    }
    await bumpGameVersion(tx, state.game.id, now);
  });

  return {
    ok: true,
    dropped: written,
    state: await getGameState(db, state.game.id),
  };
}
