import GamePageLinks from "../../components/GamePageLinks";
import Hint from "../../components/Hint";
import PageHeader from "../../components/PageHeader";
import { formatAt, formatNumber } from "../../lib/format";
import type { GameSnapshotsData } from "./types";

type Props = {
  data: GameSnapshotsData;
  onOpen: (snapshotId: string) => void;
  onRefresh: () => Promise<void>;
  onTake: () => Promise<void>;
};

/**
 * 快照：这一局在磁盘上留过哪些只读投影。
 *
 * 落一份是「读库 + 写盘」，不跑模型、不改状态；所以这个按钮平放即可，不用确认。
 */
export default function GameSnapshotsPage({ data, onOpen, onRefresh, onTake }: Props) {
  const snapshots = data.snapshots ?? [];

  return (
    <main className="admin">
      <PageHeader
        crumbs={[
          { label: "总览", to: "/" },
          { label: "局", to: "/games" },
          { label: data.slug, to: `/g/${encodeURIComponent(data.slug)}` },
        ]}
        nav={<GamePageLinks slug={data.slug} current="snapshots" />}
        title={<code>{data.slug}</code>}
        onRefresh={() => void onRefresh()}
      >
        {data.busy === undefined ? null : <span className="badge badge--pending">{data.busy}</span>}
        <button type="button" className="button" onClick={() => void onTake()}>
          落快照
        </button>
      </PageHeader>

      {data.actionError === undefined ? null : <p className="form-error">{data.actionError}</p>}
      {data.lastPath === undefined ? null : (
        <p className="muted">
          已写入 <code>{data.lastPath}</code>
        </p>
      )}

      <section className="panel">
        <h2>
          快照
          <Hint text="每份快照是那一刻的完整只读切片：world / game / messages / 全部记忆 + manifest。存在 logs/worlds 下，库才是权威状态源。" />
        </h2>
        <p className="muted">
          <code>{data.dir ?? "…"}</code>
        </p>

        {data.snapshots === undefined ? (
          <p className="muted">{data.snapshotsError ?? "读取中…"}</p>
        ) : snapshots.length === 0 ? (
          <p className="muted">这一局还没有快照。</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>时间</th>
                <th>版本</th>
                <th>动作</th>
                <th>份数</th>
                <th>内容版本</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {snapshots.map((snapshot) => (
                <tr key={snapshot.snapshotId}>
                  <td>{formatAt(snapshot.createdAt)}</td>
                  <td>{snapshot.dbVersion === null ? "—" : formatNumber(snapshot.dbVersion)}</td>
                  <td>{snapshot.action ?? "—"}</td>
                  <td>{formatNumber(snapshot.parts)}</td>
                  <td>
                    <code>{snapshot.contentVersion ?? "—"}</code>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => onOpen(snapshot.snapshotId)}
                    >
                      内容
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
