import { useParams } from "react-router";
import GameSnapshotContainer from "./GameSnapshotContainer";

export default function GameSnapshotRoute() {
  const { slug = "", snapshot = "" } = useParams();
  return <GameSnapshotContainer slug={slug} snapshotId={snapshot} />;
}
