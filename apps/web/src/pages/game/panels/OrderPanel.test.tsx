import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ActionOrder } from "../../../features/action-order/useActionOrder";
import OrderPanel from "./OrderPanel";

function makeOrder(): ActionOrder {
  return {
    id: "order-1",
    status: "active",
    createdAt: "2026-01-02T03:04:05.000Z",
    completedAt: null,
    gameVersion: 2,
    entries: [
      {
        actorId: "a",
        actorName: "戈特",
        position: 1,
        agility: 6,
        turnsTaken: 1,
        control: "agent",
        alive: true,
      },
      {
        actorId: "b",
        actorName: "无名旅人",
        position: 2,
        agility: 6,
        turnsTaken: 0,
        control: "player",
        alive: true,
      },
      {
        actorId: "c",
        actorName: "温娜",
        position: 3,
        agility: 3,
        turnsTaken: 0,
        control: "agent",
        alive: false,
      },
    ],
    nextActor: { position: 2, actorId: "b", actorName: "无名旅人", control: "player" },
  };
}

describe("OrderPanel", () => {
  it("名次、执行方、计数、出局都写在一行；下一个单独标出来", () => {
    render(<OrderPanel order={makeOrder()} selfActorId="b" />);

    const list = screen.getByLabelText("行动顺位");
    expect(list).toHaveTextContent("#1 戈特");
    expect(list).toHaveTextContent("agent · 已动 1 回合");

    // 自己那一行有记号，避免界面把别人的计数当成自己的。
    expect(list).toHaveTextContent("#2 无名旅人（我）");
    expect(list).toHaveTextContent("← 下一个");

    // 出局的人还留在顺位上，但标出来——计数不再推进，名次仍然占着。
    expect(list).toHaveTextContent("#3 温娜（已出局）");
  });
});
