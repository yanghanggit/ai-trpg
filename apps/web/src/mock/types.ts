import type { ReactElement } from "react";

/**
 * 一个页面的 mock 描述。
 *
 * 只有一条渲染路径：fixture。真数据由正式客户端自己展示——mock 不是调试面板，
 * 它存在的意义是让页面在不启动服务端时也能被开发和被看。
 */
export type MockPage = {
  key: string;
  title: string;
  /** 状态名即 fixture 的键；深链接里的 `state` 就是它。 */
  states: readonly string[];
  renderFixture: (args: { state: string }) => ReactElement;
};
