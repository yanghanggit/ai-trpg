import { useParams } from "react-router";
import GameStoriesContainer from "./GameStoriesContainer";

export default function GameStoriesRoute() {
  const { slug = "" } = useParams();
  return <GameStoriesContainer slug={slug} />;
}
