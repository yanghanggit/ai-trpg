import type {
  ActorAction,
  ActorState,
  AnnounceAction,
  CallAction,
  GameStateSlice,
  SayAction,
  WhisperAction,
} from "../types";
import type { DialogueContext } from "./types";

/**
 * 玩家入口的适配：哪一条动作需要审核，审核之前要准备什么上下文。
 *
 * 审核器不认识动作计划，只认识一句台词与它的来处；这两件事在这里翻译一次，
 * 其余地方不再重复判断「哪些动作算对话」。
 */

export function isDialogueAction(
  action: ActorAction,
): action is SayAction | WhisperAction | AnnounceAction | CallAction {
  return (
    action.kind === "say" ||
    action.kind === "whisper" ||
    action.kind === "announce" ||
    action.kind === "call"
  );
}

/** 供玩家入口使用的上下文构造；目标 id 由调用方预解析。 */
export function dialogueContextFor(
  state: GameStateSlice,
  actor: ActorState,
  stageName: string,
  action: SayAction | WhisperAction | AnnounceAction | CallAction,
  targetActorId?: string | null,
): DialogueContext {
  return {
    gameId: state.game.id,
    playerId: state.player.id,
    actorId: actor.id,
    targetActorId: targetActorId ?? null,
    actionKind: action.kind,
    message: action.message,
    actorName: actor.name,
    stageName,
    world: state.world,
  };
}
