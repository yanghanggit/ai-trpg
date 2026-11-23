import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { gameFixtures, gameHistoryFixtures } from "../../mock/fixtures/game";
import Dialog from "./Dialog";
import GamePage from "./GamePage";
import HistoryPanel from "./panels/HistoryPanel";

function renderGame(state: keyof typeof gameFixtures = "active") {
  // 不套 Router：这一页不该依赖路由（没有返回入口之类的导航）。
  return render(
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
    />,
  );
}

describe("GamePage", () => {
  it("主页是两排卡片：舞台与它的锚点出口、在场角色", () => {
    renderGame();

    // 第一排：舞台本身 + 锚点 + 出口。
    expect(screen.getByRole("button", { name: /舞台\s*鸦葬岗/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /锚点\s*最高的木杆/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /锚点\s*新挖的坑/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /出口\s*守夜塔/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /出口\s*封尸窖/ })).toBeInTheDocument();

    // 第二排：在场角色，自己在卡片上标成「我」。
    expect(screen.getByRole("button", { name: /我\s*拾骨人伊莱/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /角色\s*收尸人卡尔/ })).toBeInTheDocument();

    // 描写类文本与局的信息都不在主页上。
    expect(screen.queryByText(/坡地上插满木杆/)).not.toBeInTheDocument();
    expect(screen.queryByText("鸦葬岗的夜")).not.toBeInTheDocument();
    expect(screen.queryByText("crow-run-1")).not.toBeInTheDocument();
  });

  it("点舞台卡片看环境，点锚点看承载，点出口看通向", () => {
    renderGame();

    fireEvent.click(screen.getByRole("button", { name: /舞台\s*鸦葬岗/ }));
    expect(screen.getByRole("dialog", { name: "鸦葬岗" })).toHaveTextContent("坡地上插满木杆");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    fireEvent.click(screen.getByRole("button", { name: /锚点\s*最高的木杆/ }));
    const anchorSheet = screen.getByRole("dialog", { name: "最高的木杆" });
    expect(within(anchorSheet).getByText("旧骨哨")).toBeInTheDocument();
    fireEvent.click(within(anchorSheet).getByRole("button", { name: "关闭" }));

    fireEvent.click(screen.getByRole("button", { name: /出口\s*守夜塔/ }));
    const exitSheet = screen.getByRole("dialog", { name: "守夜塔" });
    expect(exitSheet).toHaveTextContent("通着");
    expect(exitSheet).toHaveTextContent("#4");
  });

  it("点自己那张卡片，与点顶部「我」是同一张浮窗", () => {
    renderGame();

    fireEvent.click(screen.getByRole("button", { name: /我\s*拾骨人伊莱/ }));

    const sheet = screen.getByRole("dialog", { name: "我" });
    expect(within(sheet).getByText("鸦葬岗的夜")).toBeInTheDocument();
    expect(within(sheet).getByText("crow-run-1")).toBeInTheDocument();
  });

  it("点别人的卡片：浮窗给出称呼、编号、生死与外观", () => {
    renderGame();

    fireEvent.click(screen.getByRole("button", { name: /角色\s*收尸人卡尔/ }));

    const sheet = screen.getByRole("dialog", { name: "收尸人卡尔" });
    expect(within(sheet).getByText("#2")).toBeInTheDocument();
    expect(within(sheet).getByText("活着")).toBeInTheDocument();
    // 外观只在浮窗里出现，卡片标题只有名字。
    expect(within(sheet).getByText(/浸过石灰的粗布围裙/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByText(/浸过石灰的粗布围裙/)).not.toBeInTheDocument();
  });

  it("顶部「我」浮窗里有局名、slug 与角色明细，并可关闭", () => {
    renderGame();

    fireEvent.click(screen.getByRole("button", { name: "我" }));

    const sheet = screen.getByRole("dialog", { name: "我" });
    expect(within(sheet).getByText("鸦葬岗的夜")).toBeInTheDocument();
    expect(within(sheet).getByText("crow-run-1")).toBeInTheDocument();
    expect(within(sheet).getByText("拾骨人伊莱")).toBeInTheDocument();
    expect(within(sheet).getByText("#1")).toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog", { name: "我" })).not.toBeInTheDocument();
  });

  it("「认得」浮窗给出名字表与去过的地方", () => {
    renderGame();

    fireEvent.click(screen.getByRole("button", { name: "认得" }));

    const sheet = screen.getByRole("dialog", { name: "认得" });
    expect(within(sheet).getByRole("heading", { name: "认得的人", level: 3 })).toBeInTheDocument();

    const rows = within(sheet).getAllByRole("row");
    expect(rows).toHaveLength(3); // 表头 + 两条
    expect(rows[1]).toHaveTextContent("收尸人卡尔");
    expect(rows[1]).toHaveTextContent("#2");
    expect(rows[1]).toHaveTextContent("内容预设");
    expect(rows[2]).toHaveTextContent("塔下那个人");
    expect(rows[2]).toHaveTextContent("在鸦葬岗改的");

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

    fireEvent.click(screen.getByRole("button", { name: "认得" }));
    const sheet = screen.getByRole("dialog", { name: "认得" });
    expect(within(sheet).getByText("还没认得任何人。")).toBeInTheDocument();
    // 开局所在舞台本身就是一次到访，所以这里永远是「去过一个地方」。
    expect(within(sheet).getByText("墓园")).toBeInTheDocument();
  });
});
