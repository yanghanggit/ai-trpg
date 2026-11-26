import { useNavigate } from "react-router";
import { describeApiError } from "../../api/describeApiError";
import { useGameBuild } from "../../features/games/useGameBuild";
import GameBuildPage from "./GameBuildPage";
import type { GameBuildData } from "./types";

export default function GameBuildContainer({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const build = useGameBuild(slug);

  const data: GameBuildData = {
    slug,
    build: build.data,
    buildError: build.isError ? describeApiError(build.error) : undefined,
  };

  return (
    <GameBuildPage
      data={data}
      onOpenConsole={() => navigate(`/g/${encodeURIComponent(slug)}`)}
      onBack={() => navigate("/games")}
    />
  );
}
