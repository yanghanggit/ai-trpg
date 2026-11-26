import Dialog from "../../pages/game/Dialog";
import HistoryDrawer from "../../pages/game/HistoryDrawer";
import StagePage from "../../pages/game/StagePage";
import { defineMockPage } from "../defineMockPage";
import { type GameMockState, gameFixtures, gameHistoryFixtures } from "../fixtures/game";

export const gameMock = defineMockPage<GameMockState>({
  key: "game",
  title: "局内",
  fixtures: gameFixtures,
  render: (state) => (
    <StagePage
      view={gameFixtures[state]}
      renderTurn={({ slug, onClose }) => (
        <Dialog title="动作" onClose={onClose}>
          <p className="muted">
            这里在正式端是「接管 + 提交一个动作」。mock 只演示形状：
            {slug} 的这一回合会入队，结果由作业终态给出。
          </p>
          <button type="button" className="button" onClick={onClose}>
            提交这一回合
          </button>
        </Dialog>
      )}
      renderHistory={({ onClose }) => (
        <HistoryDrawer
          onClose={onClose}
          history={{
            items: gameHistoryFixtures[state],
            total: gameHistoryFixtures[state].length,
            hasMore: false,
            loadMore: () => undefined,
            loading: false,
            loadingMore: false,
          }}
        />
      )}
    />
  ),
});
