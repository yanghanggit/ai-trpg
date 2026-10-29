import type { TraceContext } from "../../debug/trace";
import type { ChatCompletionService } from "../../llm";
import type { AddressLookup } from "../addressing";
import type { ActorRow, ActorWithStageRow, Executor, ItemRow, StageRow } from "../apply/types";
import type { ItemEffect } from "../types";

/** 动作分派给效果 handler 时携带的上下文；不带物品的动作（如 `brawl`）省略 `item`。 */
export type ItemEffectContext = {
  executor: Executor;
  gameId: string;
  actorRow: ActorWithStageRow;
  stage: StageRow;
  actionKind: "strike" | "brawl" | "use";
  effect: ItemEffect;
  item?: ItemRow;
  target?: ActorRow;
  targetStage?: StageRow;
  /** 出手者视角的引用；行动反馈必须经过它，不能直接写真名。 */
  address?: AddressLookup;
  targetAnchor?: string;
  /** 伤害来源：默认效果省略；词缀追加写 `affix`。 */
  via?: "affix";
  now: Date;
  /** 所属回合的轨迹；观察与子阶段结果写进该回合。 */
  trace?: TraceContext;
};

export type ItemEffectHandler = (context: ItemEffectContext) => Promise<string>;

/** 默认 effect 完成后，需要交给补充 affix agent 的上下文。 */
export type AffixRequest = {
  actorId: string;
  itemId: string;
  actionKind: "strike" | "brawl" | "use";
  targetActorId?: string;
  targetStageId?: string;
  targetAnchor?: string;
  defaultFeedback: string;
};

export type AffixAgentOptions = {
  service: ChatCompletionService;
};
