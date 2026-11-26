import { useParams } from "react-router";
import GameConsole from "./GameConsole";

/** 路由壳：把 `:slug` 交给容器。 */
export default function GameRoute() {
  const { slug = "" } = useParams();
  return <GameConsole slug={slug} />;
}
