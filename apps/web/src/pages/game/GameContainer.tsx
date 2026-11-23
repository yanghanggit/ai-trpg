import { describeApiError } from "../../api/describeApiError";
import { useGame } from "../../features/games/useGame";
import { adaptGameState } from "./adapt";
import GamePage from "./GamePage";

/** 取数 + 映射；渲染交给 `GamePage`。mock 的 `source=api` 也走这里。 */
export default function GameContainer({ slug }: { slug: string }) {
  const game = useGame(slug);

  if (game.isPending) {
    return (
      <main className="launch">
        <div className="launch__inner">
          <p className="muted">读取中…</p>
        </div>
      </main>
    );
  }

  if (game.isError) {
    return (
      <main className="launch">
        <div className="launch__inner">
          <p className="form-error" role="alert">
            {describeApiError(game.error)}
          </p>
        </div>
      </main>
    );
  }

  return <GamePage data={adaptGameState(game.data, slug)} />;
}
