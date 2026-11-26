import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { gameFixtures, gameHistoryFixtures } from "../../mock/fixtures/game";
import HistoryDrawer from "./HistoryDrawer";
import StagePage from "./StagePage";

function renderGame(state: keyof typeof gameFixtures = "active") {
  // 不套 Router：这一页不该依赖路由（没有返回入口之类的导航）。
  return render(
    <StagePage
      view={gameFixtures[state]}
      renderTurn={({ onClose }) => (
        <button type="button" onClick={onClose}>
          提交这一回合
        </button>
      )}
      renderHistory={({ onClose }) => (
        <HistoryDrawer
          onClose={onClose}
          history={{
            items: gameHistoryFixtures[state],
            total: gameHistoryFixtures[state].length,
            hasMore: false,
            loadMore: () => undefined,
            loading: false,
            loadingMore: false,
          }}
        />
      )}
    />,
  );
}

describe("StagePage", () => {
  it("主页是两排卡片：舞台与它的锚点、在场角色", () => {
    renderGame();

    // 第一排：舞台本身 + 锚点。出口不占卡片，只写在舞台卡的底注上。
    const stageCard = screen.getByRole("button", { name: /舞台\s*鸦葬岗/ });
    // 卡面只报出口数（锚点数不显示），并且加大加亮。
    expect(stageCard).toHaveTextContent("出口 2");
    expect(stageCard).not.toHaveTextContent("锚点 2");
    expect(stageCard.querySelector(".card__count")).toHaveTextContent("出口 2");

    // 锚点卡面只有描写与「道具 n」，具体名字点开浮窗才看。
    const anchorCard = screen.getByRole("button", { name: /锚点\s*最高的木杆/ });
    expect(anchorCard).toHaveTextContent("杆上挂着褪色的布条");
    expect(anchorCard.querySelector(".card__count")).toHaveTextContent("道具 1");
    expect(anchorCard).not.toHaveTextContent("旧骨哨");
    expect(screen.getByRole("button", { name: /锚点\s*新挖的坑/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /出口\s*守夜塔/ })).not.toBeInTheDocument();

    // 第二排：在场角色，自己在卡片上标成「我」。
    expect(screen.getByRole("button", { name: /我\s*拾骨人伊莱/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /角色\s*收尸人卡尔/ })).toBeInTheDocument();

    // 舞台卡面上带环境摘要（全文在浮窗里）；局的信息仍不铺在主页上。
    expect(stageCard).toHaveTextContent("坡地上插满木杆");
    expect(screen.queryByText("鸦葬岗的夜")).not.toBeInTheDocument();
    expect(screen.queryByText("crow-run-1")).not.toBeInTheDocument();
  });

  it("点舞台卡片看环境与出口，点锚点看承载", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    renderGame();

    // 舞台浮窗：只有出口（环境摘要已经在卡面上）。
    fireEvent.click(screen.getByRole("button", { name: /舞台\s*鸦葬岗/ }));
    const stageSheet = screen.getByRole("dialog", { name: "鸦葬岗" });
    expect(stageSheet).not.toHaveTextContent("坡地上插满木杆");
    // 出口与道具、舞台一样是卡片：2 扇门 + 6 个空格。
    expect(stageSheet.querySelectorAll(".slot")).toHaveLength(8);
    expect(within(stageSheet).getByRole("button", { name: /守夜塔/ })).toHaveTextContent("通着");
    expect(within(stageSheet).getByRole("button", { name: /封尸窖/ })).toHaveTextContent("通着");

    fireEvent.click(within(stageSheet).getByRole("button", { name: /守夜塔/ }));
    expect(log).toHaveBeenCalledWith("出口", "鸦葬岗", "守夜塔");
    expect(screen.getByRole("dialog", { name: "鸦葬岗" })).toBeInTheDocument();
    fireEvent.click(within(stageSheet).getByRole("button", { name: "关闭" }));

    fireEvent.click(screen.getByRole("button", { name: /锚点\s*最高的木杆/ }));
    const anchorSheet = screen.getByRole("dialog", { name: "最高的木杆" });
    // 陈列道具与背包同一种卡片：1 件 + 7 个空格。
    expect(anchorSheet.querySelectorAll(".slot")).toHaveLength(8);
    expect(within(anchorSheet).getByRole("button", { name: /旧骨哨/ })).toBeInTheDocument();
    // 描写已经在卡面上，浮窗里不重复。
    expect(anchorSheet).not.toHaveTextContent("杆上挂着褪色的布条");

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

  it("顶部常驻头像与读数：头像开「本人」，读数不点也看得见", () => {
    renderGame();

    // 头像是「本人」的入口，名字靠 aria-label，不靠图形。
    const avatar = screen.getByRole("button", { name: "本人" });
    expect(avatar).toHaveTextContent("拾");

    // 生命与三项源属性都直接摆在条上，不用先开浮窗。
    const bar = screen.getByRole("navigation");
    expect(within(bar).getByText("生命").closest("div")).toHaveTextContent("9");
    expect(within(bar).getByText("力量").closest("div")).toHaveTextContent("4");
    expect(within(bar).getByText("智慧").closest("div")).toHaveTextContent("1");
    expect(within(bar).getByText("敏捷").closest("div")).toHaveTextContent("3");

    fireEvent.click(avatar);
    const me = screen.getByRole("dialog", { name: "本人" });
    // 明细里把读数压成一行（顶部条上已经有一份），含上限。
    const dd = within(me).getByText(/生命 9 \/ 12/);
    expect(dd).toHaveTextContent("力量 4");
    expect(dd).toHaveTextContent("敏捷 3");
    expect(within(me).queryByText("伤害")).not.toBeInTheDocument();
  });

  it("「背包」在顶部按钮组里，不再藏在「本人」里", () => {
    renderGame();

    // 「本人」浮窗里没有背包入口。
    fireEvent.click(screen.getByRole("button", { name: "本人" }));
    const me = screen.getByRole("dialog", { name: "本人" });
    expect(within(me).queryByRole("button", { name: /背包/ })).not.toBeInTheDocument();
    fireEvent.click(within(me).getByRole("button", { name: "关闭" }));

    fireEvent.click(screen.getByRole("button", { name: "背包" }));
    const bag = screen.getByRole("dialog", { name: "背包" });
    // 5 件道具 + 3 个空格：格子数永远是 4 的倍数，最少两排。
    expect(bag.querySelectorAll(".slot")).toHaveLength(8);
    // 空格子自带 aria-hidden，所以只有真道具进无障碍树。
    expect(within(bag).getAllByRole("listitem")).toHaveLength(5);
    expect(within(bag).getByText("拾骨钩")).toBeInTheDocument();
    expect(within(bag).getByText("武器")).toBeInTheDocument();
  });

  it("「相识」浮窗是卡片：编号、我叫他什么、形态", () => {
    renderGame();

    fireEvent.click(screen.getByRole("button", { name: "相识" }));

    const sheet = screen.getByRole("dialog", { name: "相识" });
    expect(within(sheet).queryByRole("table")).not.toBeInTheDocument();
    // 2 个人 + 6 个空格：格数是最少两排、4 的倍数。
    expect(sheet.querySelectorAll(".slot")).toHaveLength(8);

    // 只数卡片：浮窗头里的「关闭」也是按钮。
    const cards = sheet.querySelectorAll(".slot--action");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("#2");
    expect(cards[0]).toHaveTextContent("收尸人卡尔");
    expect(cards[0]).toHaveTextContent("人类:瘦高，左眼被蜡封住");
    // 称呼来源不回显。
    expect(sheet).not.toHaveTextContent("内容预设");
    expect(sheet).not.toHaveTextContent("在鸦葬岗改的");
    // 地方不在「相识」里，去的门在「行迹」。
    expect(within(sheet).queryByText("守夜塔")).not.toBeInTheDocument();
  });

  it("锚点浮窗把道具排成竖向列表，点一下只打日志", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    renderGame();

    fireEvent.click(screen.getByRole("button", { name: /锚点\s*最高的木杆/ }));

    const sheet = screen.getByRole("dialog", { name: "最高的木杆" });
    // 卡片网格：1 件真道具 + 7 个空格（最少两排、4 的倍数）。
    expect(sheet.querySelectorAll(".slot")).toHaveLength(8);
    expect(sheet.querySelectorAll(".slot--action")).toHaveLength(1);

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

  it("「行迹」浮窗是卡片网格，每格都能点（暂时只打日志）", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    renderGame();

    fireEvent.click(screen.getByRole("button", { name: "行迹" }));

    const sheet = screen.getByRole("dialog", { name: "行迹" });
    // 2 个舞台 + 6 个空格。
    expect(sheet.querySelectorAll(".slot")).toHaveLength(8);

    const cards = sheet.querySelectorAll(".slot--action");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("鸦葬岗");

    fireEvent.click(within(sheet).getByRole("button", { name: /守夜塔/ }));
    // 走过去是一次动作提交，这一版先不做，只留一条日志当接线点。
    expect(log).toHaveBeenCalledWith("行迹", "守夜塔", "st2");
    expect(screen.getByRole("dialog", { name: "行迹" })).toBeInTheDocument();

    log.mockRestore();
  });

  it("「记录」浮窗由注入的容器渲染事件流", () => {
    renderGame();

    fireEvent.click(screen.getByRole("button", { name: "记录" }));

    const sheet = screen.getByRole("dialog", { name: "记录" });
    // 记录是右侧板，不是居中浮窗。
    expect(sheet).toHaveClass("sheet--drawer");
    expect(within(sheet).getByText(/今晚别往窖里去/)).toBeInTheDocument();
    expect(within(sheet).getByText("已载入 18 / 18 条")).toBeInTheDocument();
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

describe("StagePage：动作入口", () => {
  it("顶部「动作」打开注入的回合浮窗，内容由外层给", () => {
    renderGame();

    // 页面自己不取数：浮窗里出现什么完全由注入决定。
    fireEvent.click(screen.getByRole("button", { name: "动作" }));
    expect(screen.getByRole("button", { name: "提交这一回合" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "提交这一回合" }));
    expect(screen.queryByRole("button", { name: "提交这一回合" })).not.toBeInTheDocument();
  });
});
