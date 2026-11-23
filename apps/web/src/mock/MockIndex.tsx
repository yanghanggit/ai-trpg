import { Link } from "react-router";
import { pages } from "../pages/registry";
import { mockPages } from "./mockPages";

/** `/`：所有页面 × 所有状态的入口；每条都是一个可收藏的深链接。 */
export default function MockIndex() {
  return (
    <main className="launch">
      <div className="launch__inner launch__inner--wide">
        <header className="launch__header">
          <p className="launch__eyebrow">AI TRPG · mock</p>
          <h1>页面目录</h1>
          <p className="launch__lead">
            每个链接直达某页的某个状态。默认用 fixture 渲染，不依赖服务端；加{" "}
            <code>source=api</code> 换成真数据对照。
          </p>
        </header>

        {mockPages.map((page) => {
          const registered = pages.find((entry) => entry.key === page.key);
          return (
            <section key={page.key} className="panel">
              <dl className="facts">
                <div>
                  <dt>页面</dt>
                  <dd>{page.title}</dd>
                </div>
                <div>
                  <dt>正式路径</dt>
                  <dd>
                    <code>{registered?.path ?? "未登记"}</code>
                  </dd>
                </div>
                <div>
                  <dt>真数据</dt>
                  <dd>{page.renderApi === undefined ? "不支持" : "source=api"}</dd>
                </div>
              </dl>

              <ul className="links">
                {page.states.map((state) => (
                  <li key={state}>
                    <Link to={`/p/${page.key}?state=${encodeURIComponent(state)}`}>
                      {page.title} · {state}
                    </Link>
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
