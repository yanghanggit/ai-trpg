import type { Database } from "../../db/pool";
import type { actors, items, stageItems, stages, worlds } from "../../db/schema";
import type { MessageVisibility } from "../actions";
import type { CommunicationIntent, InteractIntent, MovementIntent, Skill } from "../types";

export type Executor = Pick<Database, "select" | "insert" | "update" | "delete">;
export type WorldRow = typeof worlds.$inferSelect;
export type StageRow = typeof stages.$inferSelect;
export type ActorRow = typeof actors.$inferSelect;
export type ItemRow = typeof items.$inferSelect;
export type StageItemRow = typeof stageItems.$inferSelect;
export type ActorWithStageRow = { actor: ActorRow; stage: StageRow };

export type PublicMessage = {
  kind: string;
  stageId: string;
  targetActorId?: string;
  visibility: MessageVisibility;
  content: string;
};

export type ResolvedCommunication = {
  kind: "communication";
  intent: CommunicationIntent;
  stage: StageRow;
  targetActor?: ActorRow;
};

export type ResolvedMovement = {
  kind: "movement";
  intent: MovementIntent;
  stage: StageRow;
  targetStage?: StageRow;
};

/** 一次通过校验的交互：技能固定、目的已解析出具体对象与道具。 */
export type ResolvedInteraction = {
  kind: "interact";
  intent: InteractIntent;
  skill: Skill;
  stage: StageRow;
  target?: ActorRow;
  targetStage?: StageRow;
  items: ItemRow[];
  transferItem?: ItemRow;
  stageItem?: StageItemRow;
};

export type ResolvedIntent = ResolvedCommunication | ResolvedMovement | ResolvedInteraction;
