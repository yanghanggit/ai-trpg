import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import EntryPage from "./EntryPage";
import type { CreateGameRequest, EntryPageData } from "./types";

const data: EntryPageData = {
  identity: { username: "demo", displayName: "演示用户" },
  packs: ["dark-fantasy:crow-grave"],
};

describe("EntryPage", () => {
  it("显示身份与内容包", () => {
    render(<EntryPage data={data} onCreate={async () => undefined} />);

    expect(screen.getByText("demo（演示用户）")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "dark-fantasy:crow-grave" })).toBeInTheDocument();
  });

  it("提交时把选中的内容包交给注入的回调", async () => {
    const onCreate = vi.fn(async (input: CreateGameRequest) => input.slug);
    render(<EntryPage data={data} onCreate={onCreate} />);

    fireEvent.change(screen.getByLabelText(/slug/), { target: { value: "mock-slug" } });
    fireEvent.click(screen.getByRole("button", { name: "开始游戏" }));

    expect(await screen.findByRole("button", { name: "开始游戏" })).toBeEnabled();
    expect(onCreate).toHaveBeenCalledWith({ seed: "dark-fantasy:crow-grave", slug: "mock-slug" });
  });

  it("建局失败时显示可读错误，且不卡在 pending", async () => {
    render(
      <EntryPage
        data={data}
        onCreate={async () => {
          throw new Error("内容包不可用");
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "开始游戏" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("内容包不可用");
    expect(screen.getByRole("button", { name: "开始游戏" })).toBeEnabled();
  });
});
