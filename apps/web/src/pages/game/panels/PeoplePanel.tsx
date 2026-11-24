import type { GameView } from "../../../features/games/useGameView";
import SlotGrid from "./SlotGrid";

/**
 * 「相识」：这个角色的认知账本——把谁当作谁，一格一个人。
 *
 * 名字不是地址：一格里写的是「我叫他什么」，编号才是身份，所以两者都摆出来。
 * 同名、改名、只记得外观都能如实表达；称呼来自哪个内容或哪次改名不回显，
 * 那是引擎记账用的，看的人只关心结论。
 */
export default function PeoplePanel({ view }: { view: GameView }) {
  const { names } = view;

  if (names.length === 0) {
    return <p className="muted">还没认得任何人。</p>;
  }

  return (
    <SlotGrid>
      {names.map((entry) => (
        <li key={entry.token}>
          <button
            type="button"
            className="slot slot--action"
            onClick={() => console.log("相识", entry.name, entry.token)}
          >
            <span className="slot__kind">
              <code>{entry.token}</code>
            </span>
            <span className="slot__name">{entry.name}</span>
            <span className="slot__note">{entry.form}</span>
          </button>
        </li>
      ))}
    </SlotGrid>
  );
}
