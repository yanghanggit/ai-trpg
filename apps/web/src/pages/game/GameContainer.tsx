import { describeApiError } from "../../api/describeApiError";
import { useGameView } from "../../features/games/useGameView";
import HistoryDialog from "./HistoryDialog";
import StagePage from "./StagePage";

/** 取数；渲染交给 `StagePage`（mock 用的也是这个页面组件）。 */
export default function GameContainer({ slug }: { slug: string }) {
  const game = useGameView(slug);

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

  return (
    <StagePage
      view={game.data}
      renderHistory={({ slug: gameSlug, onClose }) => (
        <HistoryDialog slug={gameSlug} onClose={onClose} />
      )}
    />
  );
}
