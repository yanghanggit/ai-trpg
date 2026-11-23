import { Link, useParams, useSearchParams } from "react-router";
import { mockPages } from "./mockPages";

/**
 * `/p/:key?state=`：按深链接渲染一个页面的一种状态。
 *
 * 页面本身与正式端一字不差；切换状态的东西放在右下角的 dev dock 里，
 * 它是叠在页面之上的一层，不参与页面布局，也不出现在正式入口。
 */
export default function Host() {
  const { key = "" } = useParams();
  const [search, setSearch] = useSearchParams();

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

      <aside className="dev-dock" aria-label="mock 状态切换">
        <span className="dev-dock__title">
          mock · {page.title} · {state}
        </span>
        <div className="dev-dock__states">
          {page.states.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className={
                candidate === state ? "dev-dock__state dev-dock__state--active" : "dev-dock__state"
              }
              onClick={() => setSearch({ state: candidate })}
            >
              {candidate}
            </button>
          ))}
        </div>
        <Link className="dev-dock__link" to="/">
          目录
        </Link>
      </aside>
    </>
  );
}
