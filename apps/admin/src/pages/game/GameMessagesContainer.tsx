import { describeApiError } from "../../api/describeApiError";
import { useGameMessages } from "../../features/games/useGameData";
import { useRefreshGame } from "../../features/games/useRefreshGame";
import GameMessagesPage from "./GameMessagesPage";
import type { GameMessagesData } from "./types";

export default function GameMessagesContainer({ slug }: { slug: string }) {
  const refresh = useRefreshGame(slug);

  const messages = useGameMessages(slug);

  const data: GameMessagesData = {
    slug,
    messages: messages.data,
    messagesError: messages.isError ? describeApiError(messages.error) : undefined,
  };

  return <GameMessagesPage data={data} onRefresh={refresh} />;
}
