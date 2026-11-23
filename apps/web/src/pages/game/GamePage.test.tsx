import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { gameFixtures, gameHistoryFixtures } from "../../mock/fixtures/game";
import Dialog from "./Dialog";
import GamePage from "./GamePage";
import HistoryPanel from "./panels/HistoryPanel";

function renderGame(state: keyof typeof gameFixtures = "active") {
  return render(
    <MemoryRouter>
      <GamePage
        view={gameFixtures[state]}
        renderHistory={({ onClose }) => (
          <Dialog title="消息历史" onClose={onClose}>
            <HistoryPanel
              history={{
                items: gameHistoryFixtures[state],
                total: gameHistoryFixtures[state].length,
                hasMore: false,
                loadMore: () => undefined,
                loading: false,
                loadingMore: false,
              }}
            />
          </Dialog>
        )}
      />
    </MemoryRouter>,
  );
}

describe("GamePage", () => {
  it("主页只保留当前舞台", () => {
    renderGame();

    expect(screen.getByRole("heading", { name: "鸦葬岗", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "在场", level: 3 })).toBeInTheDocument();
    // 记忆日志与候选清单都不再进客户端。
    expect(screen.queryByRole("heading", { name: "感知日志" })).not.toBeInTheDocument();
    expect(screen.queryByText("可传送")).not.toBeInTheDocument();
    // 三样需要时才看的东西不在主页里。
    expect(screen.queryByText("我这样称呼别人")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "去过", level: 3 })).not.toBeInTheDocument();
  });

  it("顶部按钮打开「我」浮窗，并可以关闭", () => {
    renderGame();

    fireEvent.click(screen.getByRole("button", { name: "我" }));

    const sheet = screen.getByRole("dialog", { name: "我" });
    expect(within(sheet).getByText("拾骨人伊莱")).toBeInTheDocument();
    expect(within(sheet).getByText("#1")).toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog", { name: "我" })).not.toBeInTheDocument();
  });

  it("「去过」浮窗只列到访过的舞台", () => {
    renderGame();

    fireEvent.click(screen.getByRole("button", { name: "去过" }));

    const sheet = screen.getByRole("dialog", { name: "去过" });
    // 浮窗标题也是「去过」，所以这里按三级标题定位分组。
    expect(within(sheet).getByRole("heading", { name: "去过", level: 3 })).toBeInTheDocument();
    expect(within(sheet).getByText("守夜塔")).toBeInTheDocument();
    expect(within(sheet).queryByRole("heading", { name: "可传送" })).not.toBeInTheDocument();
  });

  it("「消息历史」浮窗由注入的容器渲染事件流", () => {
    renderGame();

    fireEvent.click(screen.getByRole("button", { name: "消息历史" }));

    const sheet = screen.getByRole("dialog", { name: "消息历史" });
    expect(within(sheet).getByText(/今晚别往窖里去/)).toBeInTheDocument();
    expect(within(sheet).getByText("已载入 4 / 4 条")).toBeInTheDocument();
  });

  it("空态：刚开局没有历史，也没有别处去过", () => {
    renderGame("fresh");

    fireEvent.click(screen.getByRole("button", { name: "消息历史" }));
    expect(screen.getByText("还没有任何事件。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    fireEvent.click(screen.getByRole("button", { name: "去过" }));
    const sheet = screen.getByRole("dialog", { name: "去过" });
    // 开局所在舞台本身就是一次到访，所以这里永远是「去过一个地方」。
    expect(within(sheet).getByText("墓园")).toBeInTheDocument();
  });
});
