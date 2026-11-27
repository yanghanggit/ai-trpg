import Hint from "../../components/Hint";
import PageHeader from "../../components/PageHeader";
import { formatAt, formatNumber } from "../../lib/format";
import type { GameSnapshotData } from "./types";

type Props = {
  data: GameSnapshotData;
  onSelectPart: (part: string | undefined) => void;
  onRefresh: () => void;
};

/** 一份快照：先看清单，再按份读原文。整份 world.json 不一次摊开。 */
export default function GameSnapshotPage({ data, onSelectPart, onRefresh }: Props) {
  return (
    <main className="admin">
      <PageHeader
        crumbs={[
          { label: "总览", to: "/" },
          { label: "局", to: "/games" },
          { label: data.slug, to: `/g/${encodeURIComponent(data.slug)}` },
          { label: "快照", to: `/g/${encodeURIComponent(data.slug)}/snapshots` },
          { label: data.snapshotId },
        ]}
        title={<code>{data.snapshotId}</code>}
        onRefresh={onRefresh}
      />

      {data.snapshotError === undefined ? null : <p className="form-error">{data.snapshotError}</p>}

      <section className="panel">
        <h2>
          清单
          <Hint text="manifest：这份快照是什么时候、按哪个动作落的，以及它由哪些份组成。份是文件名，读哪一份由你选。" />
        </h2>
        {data.manifest === undefined ? (
          <p className="muted">{data.loading ? "读取中…" : "没有这份快照。"}</p>
        ) : (
          <>
            <dl className="facts">
              <div>
                <dt>动作</dt>
                <dd>{String(data.manifest.action ?? "—")}</dd>
              </div>
              <div>
                <dt>落盘时间</dt>
                <dd>{formatAt(String(data.manifest.createdAt ?? ""))}</dd>
              </div>
              <div>
                <dt>库版本</dt>
                <dd>
                  {typeof data.manifest.dbVersion === "number"
                    ? formatNumber(data.manifest.dbVersion)
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>内容版本</dt>
                <dd>
                  <code>{String(data.manifest.contentVersion ?? "—")}</code>
                </dd>
              </div>
              <div>
                <dt>份数</dt>
                <dd>{formatNumber(data.parts.length)}</dd>
              </div>
            </dl>
            <details className="details">
              <summary>原始 manifest</summary>
              <pre className="json">{JSON.stringify(data.manifest, null, 2)}</pre>
            </details>
          </>
        )}
      </section>

      <section className="panel">
        <h2>原文</h2>
        <div className="inline-form">
          <label className="field">
            <span>读哪一份（{formatNumber(data.parts.length)} 份）</span>
            <select
              value={data.part ?? ""}
              onChange={(event) =>
                onSelectPart(event.target.value === "" ? undefined : event.target.value)
              }
            >
              <option value="">（只看清单）</option>
              {data.parts.map((part) => (
                <option key={part} value={part}>
                  {part}
                </option>
              ))}
            </select>
          </label>
        </div>

        {data.part === null ? (
          <p className="muted">选一份看原文。</p>
        ) : data.content === undefined ? (
          <p className="muted">读取中…</p>
        ) : (
          <pre className="json json--tall">{data.content}</pre>
        )}
      </section>
    </main>
  );
}
