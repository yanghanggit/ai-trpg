import type { Database } from "../../db/pool";
import type { actors, items, stageItems, stages, worlds } from "../../db/schema";

/**
 * 状态层的行投影与事务执行器。
 *
 * 只回答两件事：一行数据长什么样、写入函数接受什么。`Executor` 不带池与事务控制，
 * 调用方决定传 `db` 还是 `tx`。放在持久化层，是因为它比任何玩法模块都低：动作、
 * 战斗、词缀、建局、记忆都用它，谁都不该反过来依赖某个玩法模块。
 */

/** 事务执行器：`Database` 的四个入口子集；池与事务控制留在调用方。 */
export type Executor = Pick<Database, "select" | "insert" | "update" | "delete">;

export type WorldRow = typeof worlds.$inferSelect;
export type StageRow = typeof stages.$inferSelect;
export type ActorRow = typeof actors.$inferSelect;
export type ItemRow = typeof items.$inferSelect;
export type StageItemRow = typeof stageItems.$inferSelect;

/** 「角色 + 它所在的场景」：动作与仲裁几乎总是同时要这两行。 */
export type ActorWithStageRow = { actor: ActorRow; stage: StageRow };
