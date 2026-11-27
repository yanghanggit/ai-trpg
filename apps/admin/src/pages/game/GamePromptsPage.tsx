import GamePageLinks from "../../components/GamePageLinks";
import Hint from "../../components/Hint";
import PageHeader from "../../components/PageHeader";
import { formatAt, formatNumber } from "../../lib/format";
import type { GamePromptsData } from "./types";

type Props = {
  data: GamePromptsData;
  onOpen: (id: string) => void;
  onRefresh: () => void;
};

function size(bytes: number): string {
  return `${formatNumber(Math.round(bytes / 1024))} KB`;
}

/**
 * 系统提示词：这一局建局时导出的 system prompt 有哪几份。
 *
 * 它是一份快照，不是实时视图：提示词改了不会回头改这里，只影响下一次建局。
 */
export default function GamePromptsPage({ data, onOpen, onRefresh }: Props) {
  const bundles = data.bundles ?? [];

  return (
    <main className="admin">
      <PageHeader
        crumbs={[
          { label: "总览", to: "/" },
          { label: "局", to: "/games" },
          { label: data.slug, to: `/g/${encodeURIComponent(data.slug)}` },
        ]}
        nav={<GamePageLinks slug={data.slug} current="prompts" />}
        title={<code>{data.slug}</code>}
        onRefresh={onRefresh}
      />

      <section className="panel">
        <h2>
          系统提示词
          <Hint text="系统提示词是模型开口之前拿到的那些字：建局时按这一局的内容渲染成 md 落盘，world、每个职能、每个舞台、每个角色各一份。内存与对话不在里面。" />
        </h2>
        <p className="muted">
          <code>{data.dir ?? "…"}</code>
        </p>

        {data.bundles === undefined ? (
          <p className="muted">{data.bundlesError ?? "读取中…"}</p>
        ) : bundles.length === 0 ? (
          <p className="muted">
            这一局没有系统提示词导出。它只在建局那一刻落盘：导出上线之前建的局，目录里就没有这一份。
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>建局时间</th>
                <th>世界</th>
                <th>内容版本</th>
                <th>文件</th>
                <th>大小</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {bundles.map((bundle) => (
                <tr key={bundle.id}>
                  <td>{formatAt(bundle.createdAt)}</td>
                  <td>{bundle.world}</td>
                  <td>
                    <code>{bundle.contentVersion}</code>
                  </td>
                  <td className="muted">
                    世界 {formatNumber(bundle.counts.world)} · 职能{" "}
                    {formatNumber(bundle.counts.functions)} · 舞台{" "}
                    {formatNumber(bundle.counts.stages)} · 角色 {formatNumber(bundle.counts.actors)}
                  </td>
                  <td>{size(bundle.bytes)}</td>
                  <td>
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => onOpen(bundle.id)}
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
    </main>
  );
}
