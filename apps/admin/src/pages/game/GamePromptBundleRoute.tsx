import { useParams } from "react-router";
import GamePromptBundleContainer from "./GamePromptBundleContainer";

export default function GamePromptBundleRoute() {
  const { slug = "", bundle = "" } = useParams();
  return <GamePromptBundleContainer slug={slug} id={bundle} />;
}
