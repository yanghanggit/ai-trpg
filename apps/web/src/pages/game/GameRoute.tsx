import { useParams } from "react-router";
import GameContainer from "./GameContainer";

/** 路由壳：把 `:slug` 交给容器，容器本身不依赖 router（mock 可以直接传 props）。 */
export default function GameRoute() {
  const { slug = "" } = useParams();
  return <GameContainer slug={slug} />;
}
