import { useNavigate } from "react-router";
import { describeApiError } from "../../api/describeApiError";
import { usePromptBundles } from "../../features/games/usePrompts";
import GamePromptsPage from "./GamePromptsPage";
import type { GamePromptsData } from "./types";

export default function GamePromptsContainer({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const bundles = usePromptBundles(slug);

  const data: GamePromptsData = {
    slug,
    dir: bundles.data?.dir,
    bundles: bundles.data?.bundles,
    bundlesError: bundles.isError ? describeApiError(bundles.error) : undefined,
  };

  return (
    <GamePromptsPage
      data={data}
      onOpen={(id) => navigate(`/g/${encodeURIComponent(slug)}/prompts/${encodeURIComponent(id)}`)}
      onRefresh={() => void bundles.refetch()}
    />
  );
}
