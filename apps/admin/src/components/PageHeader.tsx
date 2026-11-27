import { Fragment, type ReactNode } from "react";
import { Link } from "react-router";
import AutoRefreshButton from "./AutoRefreshButton";
import Hint from "./Hint";

export type Crumb = {
  label: string;
  /** 没有 `to` 就是当前页：纯文字，不给点。 */
  to?: string;
};

type Props = {
  /** 从「总览」到当前页的路径；末位是这一页的名字。 */
  crumbs: Crumb[];
  /** 这一页的对象（slug、回合 id）或页名；列表页就是页名。 */
  title: ReactNode;
  hint?: string;
  /** 同一层的其它页，接在面包屑后面：导航只出现在这一行。 */
  nav?: ReactNode;
  /** 页面自己的动作，排在自动刷新/刷新的左边。 */
  children?: ReactNode;
  onRefresh?: () => void;
  /** 只给破坏性动作留的位置：永远在最右。 */
  danger?: ReactNode;
};

/**
 * 页头：面包屑说明「你在哪」，标题说明「这是什么」，右侧只放动作。
 *
 * 右侧的顺序是固定的：页面动作 → 自动刷新 → 刷新 → 危险操作。这样切页时
 * 「自动刷新」和「刷新」不会左右乱跳，手不用重新找。
 */
export default function PageHeader({
  crumbs,
  title,
  hint,
  nav,
  children,
  onRefresh,
  danger,
}: Props) {
  return (
    <header className="admin__bar">
      <div>
        {/* 面包屑：一级一个可点的盒子，中间用分隔符，不靠空格排版。 */}
        <nav className="eyebrow" aria-label="位置">
          {crumbs.map((crumb, index) => {
            // 同名标签（局、轨迹）出现在不同层级：key 用「目标地址 + 标签」。
            const key = `${crumb.to ?? "here"}:${crumb.label}`;
            return (
              <Fragment key={key}>
                {index === 0 ? null : (
                  <span className="eyebrow__sep" aria-hidden="true">
                    /
                  </span>
                )}
                {crumb.to === undefined ? (
                  <span className="eyebrow__here">{crumb.label}</span>
                ) : (
                  <Link to={crumb.to}>{crumb.label}</Link>
                )}
              </Fragment>
            );
          })}
          {nav === undefined ? null : (
            <>
              {crumbs.length === 0 ? null : (
                <span className="eyebrow__sep" aria-hidden="true">
                  /
                </span>
              )}
              <span className="eyebrow__pages">{nav}</span>
            </>
          )}
        </nav>
        <h1>
          {title}
          {hint === undefined ? null : <Hint text={hint} />}
        </h1>
      </div>

      <div className="admin__actions">
        {children}
        <AutoRefreshButton />
        {onRefresh === undefined ? null : (
          <button type="button" className="button button--ghost" onClick={onRefresh}>
            刷新
          </button>
        )}
        {danger}
      </div>
    </header>
  );
}
