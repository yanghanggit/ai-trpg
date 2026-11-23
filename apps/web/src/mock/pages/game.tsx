import GamePage from "../../pages/game/GamePage";
import { defineMockPage } from "../defineMockPage";
import { type GameMockState, gameFixtures } from "../fixtures/game";

export const gameMock = defineMockPage<GameMockState>({
  key: "game",
  title: "局内",
  fixtures: gameFixtures,
  render: (state) => <GamePage view={gameFixtures[state]} />,
});
