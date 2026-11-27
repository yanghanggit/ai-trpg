import { useSearchParams } from "react-router";
import { describeApiError } from "../../api/describeApiError";
import { useGameMessages } from "../../features/games/useGameData";
import { useRefreshGame } from "../../features/games/useRefreshGame";
import GameMessagesPage from "./GameMessagesPage";
import { type MessageOrder, orderMessages, parseMessageOrder } from "./messagesOrder";
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

  const order = parseMessageOrder(params.get("order"));

  function toggleOrder(): void {
    const next: MessageOrder = order === "asc" ? "desc" : "asc";
    const updated = new URLSearchParams(params);
    if (next === "asc") {
      // 默认值不写进地址栏：干净的链接就是正序。
      updated.delete("order");
    } else {
      updated.set("order", next);
    }
    setParams(updated, { replace: true });
  }

  const data: GameMessagesData = {
    slug,
    order,
    ...(messages.data === undefined ? {} : { messages: orderMessages(messages.data, order) }),
    ...(messages.isError ? { messagesError: describeApiError(messages.error) } : {}),
  };

  return <GameMessagesPage data={data} onRefresh={refresh} onToggleOrder={toggleOrder} />;
}
