import { useState } from "react";
import { useNavigate } from "react-router";
import { describeApiError } from "../../api/describeApiError";
import { useSnapshots } from "../../features/games/useArtifacts";
import { useGameActions } from "../../features/games/useGameActions";
import { useRefreshGame } from "../../features/games/useRefreshGame";
import GameSnapshotsPage from "./GameSnapshotsPage";
import type { GameSnapshotsData } from "./types";

export default function GameSnapshotsContainer({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const refresh = useRefreshGame(slug);
  const actions = useGameActions(slug);
  const snapshots = useSnapshots(slug);

  const [busy, setBusy] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [lastPath, setLastPath] = useState<string>();

  const data: GameSnapshotsData = {
    slug,
    dir: snapshots.data?.dir,
    snapshots: snapshots.data?.snapshots,
    snapshotsError: snapshots.isError ? describeApiError(snapshots.error) : undefined,
    busy,
    actionError,
    lastPath,
  };

  return (
    <GameSnapshotsPage
      data={data}
      onOpen={(snapshotId) =>
        navigate(`/g/${encodeURIComponent(slug)}/snapshots/${encodeURIComponent(snapshotId)}`)
      }
      onRefresh={refresh}
      onTake={async () => {
        setBusy("落快照");
        setActionError(undefined);
        try {
          const result = (await actions.snapshot()) as { path?: unknown };
          setLastPath(typeof result.path === "string" ? result.path : undefined);
          await snapshots.refetch();
        } catch (caught) {
          setActionError(describeApiError(caught));
        } finally {
          setBusy(undefined);
        }
      }}
    />
  );
}
