import { useNavigate } from "react-router";
import EntryContainer from "../../pages/entry/EntryContainer";
import EntryPage from "../../pages/entry/EntryPage";
import { defineMockPage } from "../defineMockPage";
import { type EntryMockState, entryFixtures } from "../fixtures/entry";

/** fixture 下也要能演示「建局 → 跳局内」，所以回调里换成 mock 内跳转。 */
function FixtureEntry({ state }: { state: EntryMockState }) {
  const navigate = useNavigate();
  return (
    <EntryPage
      data={entryFixtures[state]}
      onCreate={
        state === "createError"
          ? async () => {
              throw new Error("模拟建局失败：内容包不可用");
            }
          : async () => {
              navigate("/p/game?state=active");
              return "mock-game-1";
            }
      }
    />
  );
}

export const entryMock = defineMockPage<EntryMockState>({
  key: "entry",
  title: "入口",
  fixtures: entryFixtures,
  renderFixture: ({ state }) => <FixtureEntry state={state} />,
  renderApi: () => <EntryContainer />,
});
