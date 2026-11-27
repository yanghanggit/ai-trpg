import { useNavigate } from "react-router";
import { describeApiError } from "../../api/describeApiError";
import { useGames } from "../../features/games/useGames";
import GamesPage from "./GamesPage";
import type { GamesData } from "./types";

export default function GamesContainer() {
  const navigate = useNavigate();
  const games = useGames();

  const data: GamesData = {
    games: games.data,
    gamesError: games.isError ? describeApiError(games.error) : undefined,
  };

  return (
    <GamesPage
      data={data}
      onOpenGame={(gameRef) => navigate(`/g/${encodeURIComponent(gameRef)}`)}
      onOpenBuild={(gameRef) => navigate(`/g/${encodeURIComponent(gameRef)}/build`)}
      onRefresh={() => void games.refetch()}
    />
  );
}
