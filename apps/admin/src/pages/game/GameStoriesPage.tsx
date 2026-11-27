import GamePageLinks from "../../components/GamePageLinks";
import Hint from "../../components/Hint";
import PageHeader from "../../components/PageHeader";
import { formatAt, formatNumber } from "../../lib/format";
import type { GameStoriesData } from "./types";

type Props = {
  data: GameStoriesData;
  onOpen: (name: string) => void;
  onRefresh: () => Promise<void>;
  onRun: () => Promise<void>;
};

/**
 * 故事：这一局生成过哪几份总结。
 *
 * 「跑一次」是真的起一个 agent：读全部记忆 + 事件流、多轮 LLM，回来才落一份 .md，
 * 并在轨迹里留一条 story 回合。所以它带着「跑一次要等一会儿」，也允许刷新后接着看清单。
 */
export default function GameStoriesPage({ data, onOpen, onRefresh, onRun }: Props) {
  const stories = data.stories ?? [];

  return (
    <main className="admin">
      <PageHeader
        crumbs={[
          { label: "总览", to: "/" },
          { label: "局", to: "/games" },
          { label: data.slug, to: `/g/${encodeURIComponent(data.slug)}` },
        ]}
        nav={<GamePageLinks slug={data.slug} current="stories" />}
        title={<code>{data.slug}</code>}
        onRefresh={() => void onRefresh()}
      >
        {data.busy === undefined ? null : <span className="badge badge--pending">{data.busy}</span>}
        <button type="button" className="button" onClick={() => void onRun()}>
          跑一次
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
          故事总结
          <Hint text="story agent 读全部记忆与事件流、多轮 LLM 后交一份故事。落盘在 logs/stories；跑它不改局状态，但会在轨迹里留一条 story 回合。" />
        </h2>
        <p className="muted">
          <code>{data.dir ?? "…"}</code>
        </p>

        {data.stories === undefined ? (
          <p className="muted">{data.storiesError ?? "读取中…"}</p>
        ) : stories.length === 0 ? (
          <p className="muted">这一局还没有故事。点右上角「跑一次」。</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>生成时间</th>
                <th>标题</th>
                <th>版本</th>
                <th>轮数</th>
                <th>文件</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {stories.map((story) => (
                <tr key={story.name}>
                  <td>{formatAt(story.createdAt)}</td>
                  <td>{story.title}</td>
                  <td>{story.version === null ? "—" : formatNumber(story.version)}</td>
                  <td>{story.rounds === null ? "—" : formatNumber(story.rounds)}</td>
                  <td>
                    <code>{story.name}</code>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => onOpen(story.name)}
                    >
                      阅读
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
