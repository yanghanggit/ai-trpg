/**
 * 旁路：不新建实体，只借某个记忆实体的一份记忆做一次推理，因此不重复携带设定——
 * 它沿用目标的宪法，也不写记忆。产物回给调用方，或写回目标实体的状态。
 *
 * 本目录只装旁路的一种形态：借记忆 + 只认一个终止工具 + 把产物写回目标状态
 * （`appearance`、`death` 的掉落）。另一种形态是只回调用方的只读探针（`probe/`）：
 * 单次 `complete`、不带工具，所以不走这里——两边共用的是「借记忆」这一行，
 * 不是整条回路。分类见 docs/agents.md。
 */
export { renderWithMemory } from "./render";
export { loadMemoryTarget, type MemoryTarget } from "./target";
export type { MemoryRenderOptions, MemoryRenderResult, MemoryRenderTask } from "./types";
