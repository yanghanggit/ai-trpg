import { useState } from "react";
import Dialog from "../../components/Dialog";
import GamePageLinks from "../../components/GamePageLinks";
import Hint from "../../components/Hint";
import PageHeader from "../../components/PageHeader";
import type { MessageView } from "../../features/games/useGameData";
import { formatAt } from "../../lib/format";
import type { GameMessagesData } from "./types";

type Props = {
  data: GameMessagesData;
  onRefresh: () => Promise<void>;
  /** 正序 / 倒序：只换摆法，不重读。 */
  onToggleOrder: () => void;
};

/**
 * 事件流：这一页只做一件事——把公共事件流按时间读一遍。
 *
 * 它是一屏长表，放在控制台里会把「推进」挤到折叠线以下，所以单独一页。
 */
export default function GameMessagesPage({ data, onRefresh, onToggleOrder }: Props) {
  const messages = data.messages ?? [];
  // 原文就是这一行本身：列表里已经带着，不必再发请求。
  const [raw, setRaw] = useState<MessageView>();

  return (
    <main className="admin">
      <PageHeader
        crumbs={[
          { label: "总览", to: "/" },
          { label: "局", to: "/games" },
          { label: data.slug, to: `/g/${encodeURIComponent(data.slug)}` },
        ]}
        nav={<GamePageLinks slug={data.slug} current="messages" />}
        title={<code>{data.slug}</code>}
        onRefresh={() => void onRefresh()}
      >
        <button type="button" className="button button--ghost" onClick={onToggleOrder}>
          顺序：{data.order === "asc" ? "正序" : "倒序"}
        </button>
      </PageHeader>

      <section className="panel">
        <h2>
          事件流
          <Hint text="公共事件流（game_messages）：上帝视角、带真实名字，只追加。新回合落地就会多一行。" />
        </h2>
        <p className="muted">
          共 {messages.length} 条{data.order === "desc" ? " · 最新在最上面" : ""}
        </p>

        {data.messages === undefined ? (
          <p className="muted">{data.messagesError ?? "读取中…"}</p>
        ) : messages.length === 0 ? (
          <p className="muted">还没有事件。</p>
        ) : (
          <table className="table table--messages">
            <thead>
              <tr>
                <th>#</th>
                <th>类型</th>
                <th>可见性</th>
                <th>内容</th>
                <th>时间</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {messages.map((message) => (
                <tr key={message.id}>
                  <td>{message.sequence}</td>
                  <td>{message.kind}</td>
                  <td>{message.visibility}</td>
                  <td>{message.content}</td>
                  <td>{formatAt(message.createdAt)}</td>
                  <td>
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => setRaw(message)}
                    >
                      原文
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <Dialog
        open={raw !== undefined}
        onClose={() => setRaw(undefined)}
        title={raw === undefined ? "消息" : `消息 #${raw.sequence} · ${raw.kind}`}
      >
        <pre className="json json--tall">
          {raw === undefined ? "" : JSON.stringify(raw, null, 2)}
        </pre>
      </Dialog>
    </main>
  );
}
