import { Link } from "react-router";
import { pages } from "../pages/registry";
import { mockPages } from "./mockPages";

/** `/`：页面 × 状态的目录。每条链接都直达某页的某个状态。 */
export default function MockIndex() {
  return (
    <main className="launch">
      <div className="launch__inner">
        <header className="launch__header">
          <p className="launch__eyebrow">AI TRPG · mock</p>
          <h1>页面目录</h1>
          <p className="launch__lead">
            每条链接直达某页的某个状态，全部由 fixture 渲染，不依赖服务端。
          </p>
        </header>

        {mockPages.map((page) => {
          const path = pages.find((entry) => entry.key === page.key)?.path;
          return (
            <section key={page.key} className="panel mock-page">
              <h2>
                {page.title}
                {path === undefined ? null : <code className="mock-page__path">{path}</code>}
              </h2>
              <ul className="links">
                {page.states.map((state) => (
                  <li key={state}>
                    <Link to={`/p/${page.key}?state=${encodeURIComponent(state)}`}>{state}</Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        <footer className="launch__footer">
          这个入口只在 <code>pnpm dev:mock</code> 下提供，正式构建不包含 mock 文件。
        </footer>
      </div>
    </main>
  );
}
