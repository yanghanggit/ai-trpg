import { useParams } from "react-router";
import GameMessagesContainer from "./GameMessagesContainer";

/** 路由壳：把 `:slug` 交给容器。 */
export default function GameMessagesRoute() {
  const { slug = "" } = useParams();
  return <GameMessagesContainer slug={slug} />;
}
