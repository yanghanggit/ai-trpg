import { Link, useParams, useSearchParams } from "react-router";
import { mockPages } from "./mockPages";

/** `/p/:key?state=`：按深链接渲染一个页面的一种状态。 */
export default function Host() {
  const { key = "" } = useParams();
  const [search] = useSearchParams();

  const page = mockPages.find((entry) => entry.key === key);
  if (page === undefined) {
    return (
      <main className="launch">
        <div className="launch__inner">
          <p className="form-error" role="alert">
            没有这个页面：{key || "(空)"}
          </p>
          <p>
            <Link to="/">返回目录</Link>
          </p>
        </div>
      </main>
    );
  }

  const state = search.get("state") ?? page.states[0] ?? "";

  return (
    <>
      <div className="mock-bar">
        <strong>{page.title}</strong>
        {page.states.map((candidate) => (
          <Link
            key={candidate}
            className={
              candidate === state ? "mock-bar__link mock-bar__link--active" : "mock-bar__link"
            }
            to={`?state=${encodeURIComponent(candidate)}`}
          >
            {candidate}
          </Link>
        ))}
        <Link className="mock-bar__link" to="/">
          目录
        </Link>
      </div>

      {page.states.includes(state) ? (
        page.renderFixture({ state })
      ) : (
        <main className="launch">
          <div className="launch__inner">
            <p className="form-error" role="alert">
              {page.key} 没有状态「{state}」，可选：{page.states.join(" / ")}
            </p>
          </div>
        </main>
      )}
    </>
  );
}
