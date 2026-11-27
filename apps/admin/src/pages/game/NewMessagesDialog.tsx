import { useEffect, useState } from "react";
import Dialog from "../../components/Dialog";
import { useMessagesAfter } from "../../features/games/useGameData";
import { formatAt } from "../../lib/format";
import { type MessageOrder, orderMessages } from "./messagesOrder";
import { readSeenCursor, writeSeenCursor } from "./seenCursor";

type Props = {
  slug: string;
  /** 这一局当前最大的序号：第一次打开时拿它当起点。 */
  latestCursor: number | undefined;
  /** 跟列表同一个顺序开关：倒着看就是最新在上。 */
  order: MessageOrder;
  onClose: () => void;
};

/**
 * 新事件：只读「上次看过之后多出来的那几条」。
 *
 * 增量靠服务端的 `?after=`——它按序号过滤，所以哪怕列表早就被截断，这里也不会漏。
 * 打开即算看过：读完把水位推到服务端给的 `messageCursor`，下次就只剩更新的。
 */
export default function NewMessagesDialog({ slug, latestCursor, order, onClose }: Props) {
  // 第一次打开没有水位：把它设成当前位置，于是「新事件」从现在开始算。
  // 两者都在开窗那一刻定下——读完就把水位写进去了，再算一遍会把自己当成「看过」。
  const [{ since, firstTime }] = useState(() => {
    const stored = readSeenCursor(slug);
    return { since: stored ?? latestCursor, firstTime: stored === undefined };
  });

  const query = useMessagesAfter(slug, since);
  const messages = query.data === undefined ? [] : orderMessages(query.data.messages, order);
  const cursor = query.data?.messageCursor;

  useEffect(() => {
    if (cursor !== undefined) {
      writeSeenCursor(slug, cursor);
    }
  }, [cursor, slug]);

  return (
    <Dialog
      open
      onClose={onClose}
      className="dialog--feed"
      title={firstTime ? "新事件" : `第 ${since ?? 0} 条之后的新事件`}
    >
      {firstTime ? (
        <p className="muted">
          第一次打开这一局，先把当前位置记到第 {cursor ?? since ?? 0}{" "}
          条；之后推进产生的新事件会出现在这里。
        </p>
      ) : null}

      {query.isError ? (
        <p className="muted">读取失败：{String((query.error as Error).message)}</p>
      ) : query.data === undefined ? (
        <p className="muted">读取中…</p>
      ) : messages.length === 0 ? (
        <p className="muted">上次看过之后还没有新事件。</p>
      ) : (
        <>
          <p className="muted">
            共 {messages.length} 条 · 到第 {query.data.messageCursor} 条
          </p>
          <table className="table table--messages">
            <thead>
              <tr>
                <th>#</th>
                <th>类型</th>
                <th>内容</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {messages.map((message) => (
                <tr key={message.id}>
                  <td>{message.sequence}</td>
                  <td>{message.kind}</td>
                  <td className="cell--wrap">{message.content}</td>
                  <td>{formatAt(message.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Dialog>
  );
}
