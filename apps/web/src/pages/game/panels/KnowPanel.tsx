import type { GameView } from "../../../features/games/useGameView";

/**
 * 「认得」：这个角色的认知账本——把谁当作谁，以及去过哪些地方。
 *
 * 名字不是地址：一行代表「这个签名，我叫他什么」；身份锚在签名编号上，
 * 所以同名、改名、只记得外观都能如实表达。
 */
export default function KnowPanel({ view }: { view: GameView }) {
  const { names, visitedStages } = view;

  return (
    <>
      <h3>认得的人</h3>
      {names.length === 0 ? (
        <p className="muted">还没认得任何人。</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>我叫他</th>
              <th>编号</th>
              <th>形态</th>
              <th>称呼来自</th>
            </tr>
          </thead>
          <tbody>
            {names.map((entry) => (
              <tr key={entry.token}>
                <td>{entry.name}</td>
                <td>
                  <code>{entry.token}</code>
                </td>
                <td>{entry.form}</td>
                <td>{describeOrigin(entry)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>去过的地方</h3>
      {visitedStages.length === 0 ? (
        <p className="muted">还没去过别的地方。</p>
      ) : (
        <ul className="chips">
          {visitedStages.map((candidate) => (
            <li key={candidate.stageId} className="chip">
              {candidate.name}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * 称呼的来源。
 *
 * 一条称呼只有一行、改名会覆盖，所以这里说的是「上次下笔的地方」，不是第一次认得的时机。
 */
function describeOrigin(entry: GameView["names"][number]): string {
  if (entry.source === "content") {
    return "内容预设";
  }
  return entry.learnedAt === null ? "你自己改的" : `在${entry.learnedAt}改的`;
}
