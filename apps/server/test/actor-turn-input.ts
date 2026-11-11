import type { ActorWithStage } from "../src/game/actor-state";
import { actorTurnContext, renderActorTurnInput } from "../src/game/agents/actor-turn";
import type { GameStateSlice } from "../src/game/kernel/types";

/**
 * 用例专用的组合入口：一步从 state 渲染出 actor 本轮的输入。
 *
 * 生产端不用它——`runActorTurn` 需要同一份 context 去生成工具表，所以显式两步
 * （`actorTurnContext` → `renderActorTurnInput`）。这里只是把那两步收成一句，
 * 免得每个断言都重复拼装。
 */
export function buildActorTurnInput(
  state: GameStateSlice,
  current: ActorWithStage,
  maxRounds?: number,
): string {
  return renderActorTurnInput(actorTurnContext(state, current), maxRounds);
}
