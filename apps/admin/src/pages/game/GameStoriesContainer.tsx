import { useState } from "react";
import { useNavigate } from "react-router";
import { describeApiError } from "../../api/describeApiError";
import { useStories } from "../../features/games/useArtifacts";
import { useGameActions } from "../../features/games/useGameActions";
import { useRefreshGame } from "../../features/games/useRefreshGame";
import GameStoriesPage from "./GameStoriesPage";
import type { GameStoriesData } from "./types";

export default function GameStoriesContainer({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const refresh = useRefreshGame(slug);
  const actions = useGameActions(slug);
  const stories = useStories(slug);

  const [busy, setBusy] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [lastPath, setLastPath] = useState<string>();

  const data: GameStoriesData = {
    slug,
    dir: stories.data?.dir,
    stories: stories.data?.stories,
    storiesError: stories.isError ? describeApiError(stories.error) : undefined,
    busy,
    actionError,
    lastPath,
  };

  return (
    <GameStoriesPage
      data={data}
      onOpen={(name) =>
        navigate(`/g/${encodeURIComponent(slug)}/stories/${encodeURIComponent(name)}`)
      }
      onRefresh={refresh}
      onRun={async () => {
        setBusy("跑故事总结");
        setActionError(undefined);
        try {
          const result = (await actions.story()) as { path?: unknown };
          setLastPath(typeof result.path === "string" ? result.path : undefined);
          await stories.refetch();
        } catch (caught) {
          setActionError(describeApiError(caught));
        } finally {
          setBusy(undefined);
        }
      }}
    />
  );
}
