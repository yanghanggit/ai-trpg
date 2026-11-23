import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { pages } from "../pages/registry";
import { mockPages } from "./mockPages";

describe("mock 目录", () => {
  it("与正式路由清单一一对应", () => {
    const keys = (entries: { key: string }[]) => entries.map((entry) => entry.key).sort();
    expect(keys(mockPages)).toEqual(keys(pages));
  });

  it("每个页面的每个状态都能渲染", () => {
    for (const page of mockPages) {
      for (const state of page.states) {
        const view = render(
          <MemoryRouter>
            {page.renderFixture({ state, params: { slug: "crow-run-1" } })}
          </MemoryRouter>,
        );
        expect(view.container.textContent?.trim()).not.toBe("");
        view.unmount();
      }
    }
  });
});
