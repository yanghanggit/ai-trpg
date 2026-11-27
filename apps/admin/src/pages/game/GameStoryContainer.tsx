import { describeApiError } from "../../api/describeApiError";
import { useStory } from "../../features/games/useArtifacts";
import GameStoryPage from "./GameStoryPage";
import type { GameStoryData } from "./types";

export default function GameStoryContainer({ slug, name }: { slug: string; name: string }) {
  const story = useStory(slug, name);

  const data: GameStoryData = {
    slug,
    name,
    content: story.data?.content,
    path: story.data?.path,
    storyError: story.isError ? describeApiError(story.error) : undefined,
  };

  return <GameStoryPage data={data} onRefresh={() => void story.refetch()} />;
}
