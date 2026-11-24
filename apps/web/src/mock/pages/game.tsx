import Dialog from "../../pages/game/Dialog";
import HistoryPanel from "../../pages/game/panels/HistoryPanel";
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
      renderHistory={({ onClose }) => (
        <Dialog title="记录" onClose={onClose}>
          <HistoryPanel
            history={{
              items: gameHistoryFixtures[state],
              total: gameHistoryFixtures[state].length,
              hasMore: false,
              loadMore: () => undefined,
              loading: false,
              loadingMore: false,
            }}
          />
        </Dialog>
      )}
    />
  ),
});
