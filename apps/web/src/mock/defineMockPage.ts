import type { MockPage, MockParams } from "./types";

type Spec<S extends string> = {
  key: string;
  title: string;
  /** 状态名 → 该状态要渲染的数据；`states` 由它的 key 自动得出，漏一个就编译不过。 */
  fixtures: Record<S, unknown>;
  params?: readonly string[];
  renderFixture: (args: { state: S; params: MockParams }) => React.ReactElement;
  renderApi?: (params: MockParams) => React.ReactElement;
};

/**
 * 把「本页的状态联合」收窄成目录表需要的统一形状。
 *
 * 这里是整个 mock 里唯一需要断言的地方：状态名来自 fixtures 的 key，
 * 调用方拿到的是 `S`，目录表只会传回 `S` 中的一个。
 */
export function defineMockPage<S extends string>(spec: Spec<S>): MockPage {
  return {
    key: spec.key,
    title: spec.title,
    states: Object.keys(spec.fixtures) as S[],
    params: spec.params ?? [],
    renderFixture: ({ state, params }) => spec.renderFixture({ state: state as S, params }),
    ...(spec.renderApi === undefined ? {} : { renderApi: spec.renderApi }),
  };
}
