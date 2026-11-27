import { Link } from "react-router";
import { useMediaQuery } from "../lib/useMediaQuery";

export type GamePage = "console" | "build" | "messages" | "snapshots" | "stories" | "prompts";

const PAGES: { key: GamePage; label: string; suffix: string }[] = [
  { key: "console", label: "局控制台", suffix: "" },
  { key: "build", label: "建局数据", suffix: "/build" },
  { key: "messages", label: "事件流", suffix: "/messages" },
  { key: "snapshots", label: "快照", suffix: "/snapshots" },
  { key: "stories", label: "故事", suffix: "/stories" },
  { key: "prompts", label: "系统提示词", suffix: "/prompts" },
];

/** 六个页名加路径一共这么长，再窄就得折行；折行会把面包屑挤成两行，不如收起来。 */
const NARROW_QUERY = "(max-width: 1210px)";

/**
 * 一局下面的六个页，接在面包屑的局地址后面：`… / clock-e2e / 快照 · 局控制台 · …`
 *
 * 导航只有这一处——页头右侧只放动作。窄屏时只留当前页，其余收进「更多」。
 */
export default function GamePageLinks({ slug, current }: { slug: string; current: GamePage }) {
  const narrow = useMediaQuery(NARROW_QUERY);
  const base = `/g/${encodeURIComponent(slug)}`;
  const currentPage = PAGES.find((page) => page.key === current) ?? PAGES[0];

  if (narrow) {
    return (
      <>
        <span className="eyebrow__here" aria-current="page">
          {currentPage?.label}
        </span>
        <details className="eyebrow__more">
          <summary>更多 ▾</summary>
          <span className="eyebrow__menu">
            {PAGES.filter((page) => page.key !== current).map((page) => (
              <Link key={page.key} to={`${base}${page.suffix}`}>
                {page.label}
              </Link>
            ))}
          </span>
        </details>
      </>
    );
  }

  return (
    <>
      {PAGES.map((page, index) => (
        <span key={page.key} className="eyebrow__page">
          {index === 0 ? null : (
            <span className="eyebrow__dot" aria-hidden="true">
              ·
            </span>
          )}
          {page.key === current ? (
            <span className="eyebrow__here" aria-current="page">
              {page.label}
            </span>
          ) : (
            <Link to={`${base}${page.suffix}`}>{page.label}</Link>
          )}
        </span>
      ))}
    </>
  );
}
