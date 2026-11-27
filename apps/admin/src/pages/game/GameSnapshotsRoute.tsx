import { useParams } from "react-router";
import GameSnapshotsContainer from "./GameSnapshotsContainer";

export default function GameSnapshotsRoute() {
  const { slug = "" } = useParams();
  return <GameSnapshotsContainer slug={slug} />;
}
