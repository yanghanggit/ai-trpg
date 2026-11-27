import { useSearchParams } from "react-router";
import { describeApiError } from "../../api/describeApiError";
import { useGameMessages } from "../../features/games/useGameData";
import { useRefreshGame } from "../../features/games/useRefreshGame";
import GameMessagesPage from "./GameMessagesPage";
import {
  type MessageOrder,
  orderMessages,
  readOrderPreference,
  resolveMessageOrder,
  writeOrderPreference,
} from "./messagesOrder";
import type { GameMessagesData } from "./types";

/**
 * 事件流的容器：读一页消息，按地址栏里的顺序摆好。
 *
 * 顺序只影响摆法，所以改顺序不发请求、也不改「共 N 条」——同一份数据换个方向读。
 */
export default function GameMessagesContainer({ slug }: { slug: string }) {
  const [params, setParams] = useSearchParams();
  const refresh = useRefreshGame(slug);
  const messages = useGameMessages(slug);

  const order = resolveMessageOrder(params.get("order"), readOrderPreference());

  function toggleOrder(): void {
    const next: MessageOrder = order === "asc" ? "desc" : "asc";
    // 两个去处都写：地址栏管这一屏，偏好管下次进这一页还这么排。
    writeOrderPreference(next);
    const updated = new URLSearchParams(params);
    updated.set("order", next);
    setParams(updated, { replace: true });
  }

  const data: GameMessagesData = {
    slug,
    order,
    ...(messages.dataUpdatedAt === 0 ? {} : { readAt: messages.dataUpdatedAt }),
    ...(messages.data === undefined
      ? {}
      : { messages: orderMessages(messages.data.messages, order) }),
    ...(messages.isError ? { messagesError: describeApiError(messages.error) } : {}),
  };

  return <GameMessagesPage data={data} onRefresh={refresh} onToggleOrder={toggleOrder} />;
}
