import type { ReactElement } from "react";

/** 深链接里的 query 参数（如 `slug`）。 */
export type MockParams = Record<string, string>;

/**
 * 一个页面的 mock 描述（状态已擦成 string，便于放进同一张目录表）。
 *
 * 两个渲染口对应「逐个开发」与「串联组装」：`renderFixture` 不触网，`renderApi` 走正式容器。
 * 页面能出现在 mock 里，前提是渲染层只吃数据——这是容器/展现分离的直接回报。
 */
export type MockPage = {
  key: string;
  title: string;
  states: readonly string[];
  /** 深链接需要带的 query 参数名。 */
  params: readonly string[];
  renderFixture: (args: { state: string; params: MockParams }) => ReactElement;
  renderApi?: (params: MockParams) => ReactElement;
};
