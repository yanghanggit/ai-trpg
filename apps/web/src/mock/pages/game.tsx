import Dialog from "../../pages/game/Dialog";
import GamePage from "../../pages/game/GamePage";
import HistoryPanel from "../../pages/game/panels/HistoryPanel";
import { defineMockPage } from "../defineMockPage";
import { type GameMockState, gameFixtures, gameHistoryFixtures } from "../fixtures/game";

export const gameMock = defineMockPage<GameMockState>({
  key: "game",
  title: "局内",
  fixtures: gameFixtures,
  render: (state) => (
    <GamePage
      view={gameFixtures[state]}
      renderHistory={({ onClose }) => (
        <Dialog title="消息历史" onClose={onClose}>
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
