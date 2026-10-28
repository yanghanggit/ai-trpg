import type { TraceContext } from "../../debug/trace";
import type { ChatCompletionService } from "../../llm";
import type { ActorRow, ActorWithStageRow, Executor, ItemRow, StageRow } from "../apply/types";
import type { ItemEffect } from "../types";

/** 动作分派给物品效果时携带的上下文；效果执行器不反向调用动作。 */
export type ItemEffectContext = {
  executor: Executor;
  gameId: string;
  actorRow: ActorWithStageRow;
  stage: StageRow;
  actionKind: "attack" | "use";
  effect: ItemEffect;
  item?: ItemRow;
  target?: ActorRow;
  targetStage?: StageRow;
  targetDetail?: string;
  now: Date;
  /** 所属回合的轨迹；观察与子阶段结果写进该回合。 */
  trace?: TraceContext;
};

export type ItemEffectHandler = (context: ItemEffectContext) => Promise<string>;

/** 默认 effect 完成后，需要交给补充 affix agent 的上下文。 */
export type AffixRequest = {
  actorId: string;
  itemId: string;
  actionKind: "attack" | "use";
  targetActorId?: string;
  targetStageId?: string;
  targetDetail?: string;
  defaultFeedback: string;
};

export type AffixAgentOptions = {
  service: ChatCompletionService;
};
