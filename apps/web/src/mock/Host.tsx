import { Link, useParams, useSearchParams } from "react-router";
import { mockPages } from "./mockPages";

/** `/p/:key?state=&source=&<params>`：按深链接渲染一个页面的一种状态。 */
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
  const source = search.get("source") === "api" ? "api" : "fixture";
  const params = Object.fromEntries(
    page.params.map((name) => [name, search.get(name) ?? ""] as const),
  );

  const known = page.states.includes(state);
  const canApi = page.renderApi !== undefined;
  const paramNames = page.params;

  /** 切换状态 / 数据源时，页面自己的参数（如 slug）跟着走。 */
  function link(next: { state?: string; source?: string }): string {
    const search = new URLSearchParams();
    search.set("state", next.state ?? state);
    if ((next.source ?? source) === "api") {
      search.set("source", "api");
    }
    for (const name of paramNames) {
      const value = params[name] ?? "";
      if (value !== "") {
        search.set(name, value);
      }
    }
    return `?${search.toString()}`;
  }

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
            to={link({ state: candidate })}
          >
            {candidate}
          </Link>
        ))}
        {canApi ? (
          <Link
            className={
              source === "api" ? "mock-bar__link mock-bar__link--active" : "mock-bar__link"
            }
            to={link({ source: source === "api" ? "fixture" : "api" })}
          >
            {source === "api" ? "真数据 ✓" : "切到真数据"}
          </Link>
        ) : null}
        <Link className="mock-bar__link" to="/">
          目录
        </Link>
      </div>

      {known ? null : (
        <main className="launch">
          <div className="launch__inner">
            <p className="form-error" role="alert">
              {page.key} 没有状态「{state}」，可选：{page.states.join(" / ")}
            </p>
          </div>
        </main>
      )}

      {known && source === "api" && page.renderApi !== undefined
        ? page.renderApi(params)
        : known
          ? page.renderFixture({ state, params })
          : null}
    </>
  );
}
