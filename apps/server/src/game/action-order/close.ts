import type { Database } from "../../db/pool";
import { GameError } from "../errors";
import type { ActionOrderState } from "../kernel/types";
import {
  deleteActionOrderRow,
  findActionOrder,
  markActionOrderCompleted,
} from "../persistence/action-orders";
import { projectActionOrder } from "./read";

/**
 * 完成：给顺位打上标记，之后它不再记数，也不再挡着开下一张。
 *
 * 已完成再完成是错误而不是幂等返回：调用方想知道自己的「这一步」有没有落到状态上。
 */
export async function completeActionOrder(
  db: Database,
  gameId: string,
  orderId: string,
): Promise<ActionOrderState> {
  const row = await requireActionOrder(db, gameId, orderId);
  if (row.status === "completed") {
    throw new GameError("invalid_state", `行动顺位已完成: ${orderId}`);
  }
  const changed = await markActionOrderCompleted(db, row.id);
  if (!changed) {
    throw new GameError("invalid_state", `行动顺位状态已变，请重读: ${orderId}`);
  }
  // 读回落库后的行：完成时间以写入的那一列为准，不在内存里另造一个。
  return projectActionOrder(db, await requireActionOrder(db, gameId, orderId));
}

/** 移除：删行，条目随外键级联。已完成与进行中的都能删，删就是不留档。 */
export async function removeActionOrder(
  db: Database,
  gameId: string,
  orderId: string,
): Promise<{ removed: string }> {
  const row = await requireActionOrder(db, gameId, orderId);
  const deleted = await deleteActionOrderRow(db, row.id);
  if (!deleted) {
    throw new GameError("invalid_state", `行动顺位状态已变，请重读: ${orderId}`);
  }
  return { removed: row.id };
}

/** 顺位必须属于这一局：别人局的 id 一律当不存在，不泄露它存在与否之外的信息。 */
async function requireActionOrder(db: Database, gameId: string, orderId: string) {
  const row = await findActionOrder(db, gameId, orderId);
  if (!row) {
    throw new GameError("not_found", `行动顺位不存在: ${orderId}`);
  }
  return row;
}
