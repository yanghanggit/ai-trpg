import type { ActorWithStage } from "../../actor-state";
import { handleOf } from "../../kernel/addressing";
import type { GameStateSlice, IdentityBinding } from "../../kernel/types";

/**
 * 同名不阻止，只回话。
 *
 * 名字是认知，重名是合法状态（两个卫兵我都叫「卫兵」）；但两个同形地址无法指认，
 * 渲染时它们都会退回 `#编号`。这里只把这件事讲清楚，让模型当回合就能决定
 * 「换个称呼」还是「以后用编号」——不替它决定，也不污染它的认知。
 */
export function describeNameCollision(input: {
  state: GameStateSlice;
  current: ActorWithStage;
  /** 本轮已经记下的称呼，用来发现同一批次内的重名。 */
  pending: readonly IdentityBinding[];
  binding: IdentityBinding;
}): string {
  const { state, current, pending, binding } = input;
  const observerNames = new Map(
    state.signatureNames
      .filter((row) => row.observerActorId === current.actor.id)
      .map((row) => [row.signatureId, row.name] as const),
  );
  const handleToActor = new Map(
    current.stage.actors.map((actor) => [handleOf(actor.signature.seq), actor] as const),
  );
  const target = handleToActor.get(binding.handle);
  const clashes: string[] = [];
  if (binding.name === current.actor.name) {
    clashes.push(`「${binding.name}」是你自己的真名`);
  }
  for (const actor of current.stage.actors) {
    if (actor.id === target?.id || actor.id === current.actor.id) {
      continue;
    }
    if (observerNames.get(actor.signature.id) === binding.name) {
      clashes.push(handleOf(actor.signature.seq));
    }
  }
  for (const item of pending) {
    if (item.handle !== binding.handle && item.name === binding.name) {
      clashes.push(item.handle);
    }
  }
  if (clashes.length === 0) {
    return "";
  }
  const who = [...new Set(clashes)].join("、");
  return `\n注意：${who} 也叫「${binding.name}」。同名会让地址退回编号，行动时用 #编号 指认；想用名字指认就给其中一个换个称呼。`;
}
