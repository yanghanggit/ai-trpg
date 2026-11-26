import type { ActionOrder } from "../../../features/action-order/useActionOrder";

/**
 * 这一轮谁先谁后：名次、由谁驱动、已经动过几回合。
 *
 * 只读顺位，不读世界——「轮到谁」是控制面的事实，不需要把整局摊开。
 */
export default function OrderPanel({
  order,
  selfActorId,
}: {
  order: ActionOrder;
  selfActorId?: string;
}) {
  return (
    <>
      <p className="muted">第 {order.clock} 刻</p>
      <dl className="rows" aria-label="行动顺位">
        {order.entries.map((entry) => {
          const next = order.nextActor?.actorId === entry.actorId;
          const dead = !entry.alive;
          return (
            <div key={entry.actorId}>
              <dt>
                #{entry.position} {entry.actorName}
                {entry.actorId === selfActorId ? "（我）" : ""}
                {dead ? "（已出局）" : ""}
                {next ? " ← 下一个" : ""}
              </dt>
              <dd className="muted">
                {entry.control === "player" ? "玩家" : "agent"} · 已动 {entry.turnsTaken} 回合
              </dd>
            </div>
          );
        })}
      </dl>
    </>
  );
}
