import { useState } from "react";
import { describeApiError } from "../../api/describeApiError";
import { useSnapshot } from "../../features/games/useArtifacts";
import GameSnapshotPage from "./GameSnapshotPage";
import type { GameSnapshotData } from "./types";

export default function GameSnapshotContainer({
  slug,
  snapshotId,
}: {
  slug: string;
  snapshotId: string;
}) {
  const [part, setPart] = useState<string>();
  const snapshot = useSnapshot(slug, snapshotId, part);

  const manifest = snapshot.data?.manifest;
  const parts = Array.isArray(manifest?.parts)
    ? (manifest.parts as unknown[]).filter((item): item is string => typeof item === "string")
    : [];

  const data: GameSnapshotData = {
    slug,
    snapshotId,
    manifest,
    parts,
    part: part ?? null,
    content: typeof snapshot.data?.content === "string" ? snapshot.data.content : undefined,
    snapshotError: snapshot.isError ? describeApiError(snapshot.error) : undefined,
    loading: snapshot.isPending,
  };

  return (
    <GameSnapshotPage
      data={data}
      onSelectPart={setPart}
      onRefresh={() => void snapshot.refetch()}
    />
  );
}
