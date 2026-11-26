import { useState } from "react";
import { useNavigate } from "react-router";
import { describeApiError } from "../../api/describeApiError";
import { useGameMessages } from "../../features/games/useGameData";
import { useRefreshGame } from "../../features/games/useRefreshGame";
import GameMessagesPage from "./GameMessagesPage";
import type { GameMessagesData } from "./types";

export default function GameMessagesContainer({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const refresh = useRefreshGame(slug);

  const [autoRefresh, setAutoRefresh] = useState(true);
  const messages = useGameMessages(slug, autoRefresh);

  const data: GameMessagesData = {
    slug,
    autoRefresh,
    messages: messages.data,
    messagesError: messages.isError ? describeApiError(messages.error) : undefined,
  };

  return (
    <GameMessagesPage
      data={data}
      onToggleAutoRefresh={() => setAutoRefresh((current) => !current)}
      onRefresh={refresh}
      onOpenConsole={() => navigate(`/g/${encodeURIComponent(slug)}`)}
    />
  );
}
