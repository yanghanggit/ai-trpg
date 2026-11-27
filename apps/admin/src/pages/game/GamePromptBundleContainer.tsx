import { useSearchParams } from "react-router";
import { describeApiError } from "../../api/describeApiError";
import { usePromptBundle } from "../../features/games/usePrompts";
import GamePromptBundlePage from "./GamePromptBundlePage";
import type { GamePromptBundleData } from "./types";

export default function GamePromptBundleContainer({ slug, id }: { slug: string; id: string }) {
  const [params, setParams] = useSearchParams();
  const bundle = usePromptBundle(slug, id);

  const data: GamePromptBundleData = {
    slug,
    id,
    bundle: bundle.data,
    file: params.get("file") ?? undefined,
    bundleError: bundle.isError ? describeApiError(bundle.error) : undefined,
  };

  return (
    <GamePromptBundlePage
      data={data}
      onSelect={(path) => setParams({ file: path }, { replace: true })}
      onRefresh={() => void bundle.refetch()}
    />
  );
}
