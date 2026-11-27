import { useParams } from "react-router";
import GamePromptsContainer from "./GamePromptsContainer";

export default function GamePromptsRoute() {
  const { slug = "" } = useParams();
  return <GamePromptsContainer slug={slug} />;
}
