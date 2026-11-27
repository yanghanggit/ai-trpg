import Hint from "../../components/Hint";
import PageHeader from "../../components/PageHeader";
import type { GameStoryData } from "./types";

type Props = { data: GameStoryData; onRefresh: () => void };

/** 一份故事原文：原样显示 markdown 文本，不做渲染——这里要的是「文件里到底写了什么」。 */
export default function GameStoryPage({ data, onRefresh }: Props) {
  return (
    <main className="admin">
      <PageHeader
        crumbs={[
          { label: "总览", to: "/" },
          { label: "局", to: "/games" },
          { label: data.slug, to: `/g/${encodeURIComponent(data.slug)}` },
          { label: "故事", to: `/g/${encodeURIComponent(data.slug)}/stories` },
          { label: data.name },
        ]}
        title={<code>{data.name}</code>}
        onRefresh={onRefresh}
      />

      {data.storyError === undefined ? null : <p className="form-error">{data.storyError}</p>}

      <section className="panel">
        <h2>
          原文
          <Hint text="文件内容原样显示：头部是生成时的元信息，下面才是故事正文。不渲染 markdown，避免多一层解释。" />
        </h2>
        {data.content === undefined ? (
          <p className="muted">读取中…</p>
        ) : (
          <pre className="json json--tall">{data.content}</pre>
        )}
      </section>
    </main>
  );
}
