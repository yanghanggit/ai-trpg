import { useParams } from "react-router";
import GameBuildContainer from "./GameBuildContainer";

/** 路由壳：把 `:slug` 交给容器。 */
export default function GameBuildRoute() {
  const { slug = "" } = useParams();
  return <GameBuildContainer slug={slug} />;
}
