import { useParams } from "react-router";
import GameStoryContainer from "./GameStoryContainer";

export default function GameStoryRoute() {
  const { slug = "", story = "" } = useParams();
  return <GameStoryContainer slug={slug} name={story} />;
}
