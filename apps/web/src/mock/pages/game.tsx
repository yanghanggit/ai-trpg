import GameContainer from "../../pages/game/GameContainer";
import GamePage from "../../pages/game/GamePage";
import { defineMockPage } from "../defineMockPage";
import { type GameMockState, gameFixtures } from "../fixtures/game";

export const gameMock = defineMockPage<GameMockState>({
  key: "game",
  title: "局内（占位）",
  fixtures: gameFixtures,
  params: ["slug"],
  renderFixture: ({ state }) => <GamePage data={gameFixtures[state]} />,
  renderApi: ({ slug }) => <GameContainer slug={slug ?? "crow-run-1"} />,
});
