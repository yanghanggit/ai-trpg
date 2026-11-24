import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { gameFixtures, gameHistoryFixtures } from "../../mock/fixtures/game";
import Dialog from "./Dialog";
import HistoryPanel from "./panels/HistoryPanel";
import StagePage from "./StagePage";

function renderGame(state: keyof typeof gameFixtures = "active") {
  // 不套 Router：这一页不该依赖路由（没有返回入口之类的导航）。
  return render(
    <StagePage
      view={gameFixtures[state]}
      renderHistory={({ onClose }) => (
        <Dialog title="记录" onClose={onClose}>
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

describe("StagePage", () => {
  it("主页是两排卡片：舞台与它的锚点、在场角色", () => {
    renderGame();

    // 第一排：舞台本身 + 锚点。出口不占卡片，只写在舞台卡的底注上。
    const stageCard = screen.getByRole("button", { name: /舞台\s*鸦葬岗/ });
    expect(stageCard).toHaveTextContent("出口 2");
    expect(screen.getByRole("button", { name: /锚点\s*最高的木杆/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /锚点\s*新挖的坑/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /出口\s*守夜塔/ })).not.toBeInTheDocument();

    // 第二排：在场角色，自己在卡片上标成「我」。
    expect(screen.getByRole("button", { name: /我\s*拾骨人伊莱/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /角色\s*收尸人卡尔/ })).toBeInTheDocument();

    // 描写类文本与局的信息都不在主页上。
    expect(screen.queryByText(/坡地上插满木杆/)).not.toBeInTheDocument();
    expect(screen.queryByText("鸦葬岗的夜")).not.toBeInTheDocument();
    expect(screen.queryByText("crow-run-1")).not.toBeInTheDocument();
  });

  it("点舞台卡片看环境与出口，点锚点看承载", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    renderGame();

    // 舞台浮窗：环境原文 + 出口按钮（通着的与封着的一起列）。
    fireEvent.click(screen.getByRole("button", { name: /舞台\s*鸦葬岗/ }));
    const stageSheet = screen.getByRole("dialog", { name: "鸦葬岗" });
    expect(stageSheet).toHaveTextContent("坡地上插满木杆");
    expect(within(stageSheet).getByRole("button", { name: /守夜塔/ })).toHaveTextContent("通着");
    expect(within(stageSheet).getByRole("button", { name: /封尸窖/ })).toHaveTextContent("通着");

    fireEvent.click(within(stageSheet).getByRole("button", { name: /守夜塔/ }));
    expect(log).toHaveBeenCalledWith("出口", "鸦葬岗", "守夜塔");
    expect(screen.getByRole("dialog", { name: "鸦葬岗" })).toBeInTheDocument();
    fireEvent.click(within(stageSheet).getByRole("button", { name: "关闭" }));

    fireEvent.click(screen.getByRole("button", { name: /锚点\s*最高的木杆/ }));
    const anchorSheet = screen.getByRole("dialog", { name: "最高的木杆" });
    // 陈列道具是竖向列表，一条一个按钮（暂时只打日志）。
    expect(within(anchorSheet).getByRole("button", { name: /旧骨哨/ })).toBeInTheDocument();

    log.mockRestore();
  });

  it("点自己那张卡片，与点顶部「本人」是同一张浮窗", () => {
    renderGame();

    fireEvent.click(screen.getByRole("button", { name: /我\s*拾骨人伊莱/ }));

    const sheet = screen.getByRole("dialog", { name: "本人" });
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

  it("顶部「本人」浮窗里有局名、slug 与角色明细，并可关闭", () => {
    renderGame();

    fireEvent.click(screen.getByRole("button", { name: "本人" }));

    const sheet = screen.getByRole("dialog", { name: "本人" });
    expect(within(sheet).getByText("鸦葬岗的夜")).toBeInTheDocument();
    expect(within(sheet).getByText("crow-run-1")).toBeInTheDocument();
    expect(within(sheet).getByText("拾骨人伊莱")).toBeInTheDocument();
    expect(within(sheet).getByText("#1")).toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog", { name: "本人" })).not.toBeInTheDocument();
  });

  it("「本人」浮窗给出属性读数，并可从「背包」打开道具格", () => {
    renderGame();

    fireEvent.click(screen.getByRole("button", { name: "本人" }));
    const me = screen.getByRole("dialog", { name: "本人" });
    expect(within(me).getByText("9 / 12")).toBeInTheDocument();
    expect(within(me).getByText("力量")).toBeInTheDocument();
    // 顺时输出不上面板。
    expect(within(me).queryByText("伤害")).not.toBeInTheDocument();

    fireEvent.click(within(me).getByRole("button", { name: /背包/ }));

    const bag = screen.getByRole("dialog", { name: "背包" });
    // 5 件道具 + 3 个空格：格子数永远是 4 的倍数，最少两排。
    expect(bag.querySelectorAll(".slot")).toHaveLength(8);
    // 空格子自带 aria-hidden，所以只有真道具进无障碍树。
    expect(within(bag).getAllByRole("listitem")).toHaveLength(5);
    expect(within(bag).getByText("拾骨钩")).toBeInTheDocument();
    expect(within(bag).getByText("武器")).toBeInTheDocument();

    // 关掉「背包」退回「本人」，而不是一路关到底。
    fireEvent.click(within(bag).getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog", { name: "背包" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "本人" })).toBeInTheDocument();
  });

  it("「相识」浮窗给出名字表", () => {
    renderGame();

    fireEvent.click(screen.getByRole("button", { name: "相识" }));

    const sheet = screen.getByRole("dialog", { name: "相识" });
    const rows = within(sheet).getAllByRole("row");
    expect(rows).toHaveLength(3); // 表头 + 两条
    expect(rows[1]).toHaveTextContent("收尸人卡尔");
    expect(rows[1]).toHaveTextContent("#2");
    expect(rows[1]).toHaveTextContent("内容预设");
    expect(rows[2]).toHaveTextContent("塔下那个人");
    expect(rows[2]).toHaveTextContent("在鸦葬岗改的");

    // 地方不在「相识」里，去的门在「行迹」。
    expect(within(sheet).queryByText("守夜塔")).not.toBeInTheDocument();
  });

  it("锚点浮窗把道具排成竖向列表，点一下只打日志", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    renderGame();

    fireEvent.click(screen.getByRole("button", { name: /锚点\s*最高的木杆/ }));

    const sheet = screen.getByRole("dialog", { name: "最高的木杆" });
    expect(within(sheet).getAllByRole("listitem")).toHaveLength(1);

    fireEvent.click(within(sheet).getByRole("button", { name: /旧骨哨/ }));
    expect(log).toHaveBeenCalledWith("道具", "最高的木杆", "旧骨哨");
    // 不跳转、不关窗：这一版还没有动作入口。
    expect(screen.getByRole("dialog", { name: "最高的木杆" })).toBeInTheDocument();

    log.mockRestore();
  });

  it("封着的出口照列，但标成过不去", () => {
    renderGame("sealed");

    fireEvent.click(screen.getByRole("button", { name: /舞台\s*封尸窖/ }));

    const sheet = screen.getByRole("dialog", { name: "封尸窖" });
    const exit = within(sheet).getByRole("button", { name: /鸦葬岗/ });
    expect(exit).toHaveTextContent("封着");
    expect(exit).toHaveTextContent("过不去");
  });

  it("「行迹」浮窗是竖向列表，每条都能点（暂时只打日志）", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    renderGame();

    fireEvent.click(screen.getByRole("button", { name: "行迹" }));

    const sheet = screen.getByRole("dialog", { name: "行迹" });
    expect(within(sheet).queryByRole("table")).not.toBeInTheDocument();

    const rows = within(sheet).getAllByRole("listitem");
    expect(rows).toHaveLength(2);

    fireEvent.click(within(sheet).getByRole("button", { name: "守夜塔" }));
    // 走过去是一次动作提交，这一版先不做，只留一条日志当接线点。
    expect(log).toHaveBeenCalledWith("行迹", "守夜塔", "st2");
    expect(screen.getByRole("dialog", { name: "行迹" })).toBeInTheDocument();

    log.mockRestore();
  });

  it("「记录」浮窗由注入的容器渲染事件流", () => {
    renderGame();

    fireEvent.click(screen.getByRole("button", { name: "记录" }));

    const sheet = screen.getByRole("dialog", { name: "记录" });
    expect(within(sheet).getByText(/今晚别往窖里去/)).toBeInTheDocument();
    expect(within(sheet).getByText("已载入 4 / 4 条")).toBeInTheDocument();
  });

  it("空态：刚开局没有历史，也没有别处去过", () => {
    renderGame("fresh");

    fireEvent.click(screen.getByRole("button", { name: "记录" }));
    expect(screen.getByText("还没有任何事件。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    fireEvent.click(screen.getByRole("button", { name: "相识" }));
    expect(screen.getByText("还没认得任何人。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    fireEvent.click(screen.getByRole("button", { name: "行迹" }));
    // 开局所在舞台本身就是一次到访，所以这里永远是「去过一个地方」。
    expect(
      within(screen.getByRole("dialog", { name: "行迹" })).getByText("墓园"),
    ).toBeInTheDocument();
  });
});
