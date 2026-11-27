import { useParams } from "react-router";
import GameMemoryContainer from "./GameMemoryContainer";

export default function GameMemoryRoute() {
  const { slug = "" } = useParams();
  return <GameMemoryContainer slug={slug} />;
}
