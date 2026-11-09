import { type Address, mentionOf } from "../addressing";
import { MEMORY_KINDS } from "../constants";
import type { ObservationView } from "./types";

/**
 * 不带数值的场景级观察：进入场景、场景自身变化、外观变化。
 *
 * 它们的共同点是没有「当事人视角」——观察者是谁不影响措词，所以只需要场景 id。
 */

/** 环境观察：进入场景、场景自身变化这类没有当事人视角的事实。 */
export function renderEnvironmentChange(content: string, stageId: string): ObservationView {
  return { content, metadata: { kind: MEMORY_KINDS.environmentObservation, stageId } };
}

/** 可见行动观察：旁观者只知道场景里发生了什么，不带数值。 */
export function renderAction(content: string, stageId: string): ObservationView {
  return { content, metadata: { kind: MEMORY_KINDS.actionObservation, stageId } };
}

/**
 * 外观变化观察：句子只给观察者视角的引用，新外观另起一行。
 *
 * 外观本身在提交时已过世界面守卫，不含名字与系统引用；这里再按观察者渲染引用，
 * 没有名字的观察者只会看到 `#编号`。
 */
export function renderAppearanceChange(
  address: Address,
  appearance: string,
  stageId: string,
): ObservationView {
  return renderAction(`# 场景动态\n${mentionOf(address)}的可见外观变了：\n${appearance}`, stageId);
}
