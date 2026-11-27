import { useState } from "react";
import GamePageLinks from "../../components/GamePageLinks";
import Hint from "../../components/Hint";
import PageHeader from "../../components/PageHeader";
import { formatAt, formatNumber } from "../../lib/format";
import CompactDialog from "./memory/CompactDialog";
import OwnerPicker from "./memory/OwnerPicker";
import ProbeDialog from "./memory/ProbeDialog";
import { KIND_LABEL } from "./memory/targets";
import type { GameMemoryData, GameMemoryMessage } from "./types";

type Props = {
  data: GameMemoryData;
  onSelect: (target: GameMemoryData["target"]) => void;
  onCompact: (target: "current" | "all") => void;
  onAsk: (question: string) => void;
  onRefresh: () => void;
};

const TYPE_BADGE: Record<GameMemoryMessage["type"], string> = {
  system: "badge badge--muted",
  human: "badge badge--pending",
  ai: "badge badge--ok",
  tool: "badge",
};

function percent(ratio: number): string {
  return `${formatNumber(Math.round(ratio * 100))}%`;
}

/**
 * 记忆：一局里每份记忆读到什么、压缩成什么样、问它一句它会怎么答。
 *
 * 读在正文里；探针与压缩各进一个弹窗——它们一个要等模型、一个会改写记忆，
 * 都不该占着页面，也不该点一下就发生。
 */
export default function GameMemoryPage({ data, onSelect, onCompact, onAsk, onRefresh }: Props) {
  const [compactOpen, setCompactOpen] = useState(false);
  const [probeOpen, setProbeOpen] = useState(false);

  const target = data.target;
  const memory = data.memory;

  return (
    <main className="admin">
      <PageHeader
        crumbs={[
          { label: "总览", to: "/" },
          { label: "局", to: "/games" },
          { label: data.slug, to: `/g/${encodeURIComponent(data.slug)}` },
        ]}
        nav={<GamePageLinks slug={data.slug} current="memory" />}
        title={<code>{data.slug}</code>}
        onRefresh={onRefresh}
      >
        {data.busy === undefined ? null : <span className="badge badge--pending">{data.busy}</span>}
        <button type="button" className="button button--ghost" onClick={() => setProbeOpen(true)}>
          探针
        </button>
        <button type="button" className="button button--ghost" onClick={() => setCompactOpen(true)}>
          压缩记忆
        </button>
      </PageHeader>

      {data.actionError === undefined ? null : <p className="form-error">{data.actionError}</p>}

      <section className="panel">
        <h2>
          记忆
          <Hint text="世界、每个舞台、每个角色各有一份记忆：system prompt 打底，之后是落账的事实、观察与认知更新。搜索按名字、key 与 id 一起匹配，`@` 只是把全部列出来。" />
        </h2>

        <OwnerPicker
          targets={data.targets}
          onSelect={(next) => onSelect(next)}
          placeholder="@ 搜世界 / 舞台 / 角色"
        />
        {data.targetsError === undefined ? null : <p className="form-error">{data.targetsError}</p>}

        {target === undefined ? (
          <p className="muted">选一个实体：世界、每个舞台、每个角色各有一份记忆。</p>
        ) : (
          <>
            <dl className="facts">
              <div>
                <dt>类型</dt>
                <dd>{KIND_LABEL[target.kind]}</dd>
              </div>
              <div>
                <dt>名字</dt>
                <dd>{target.name}</dd>
              </div>
              <div>
                <dt>消息</dt>
                <dd>{memory === undefined ? "…" : formatNumber(memory.messages)}</dd>
              </div>
              <div>
                <dt>上下文使用率</dt>
                <dd>{memory === undefined ? "…" : percent(memory.memory.contextUsageRatio)}</dd>
              </div>
            </dl>

            {data.memoryError === undefined ? null : (
              <p className="form-error">{data.memoryError}</p>
            )}

            {memory === undefined ? (
              data.memoryError === undefined ? (
                <p className="muted">读取中…</p>
              ) : null
            ) : (
              <ol className="memory">
                {memory.memory.messages.map((message) => (
                  <li key={message.sequence} className="memory__item">
                    <p className="memory__head">
                      <span className={TYPE_BADGE[message.type]}>{message.type}</span>
                      <span className="muted">#{formatNumber(message.sequence)}</span>
                      <span className="muted">{formatAt(message.createdAt)}</span>
                    </p>
                    <pre className="json">{message.content}</pre>
                    {message.toolCalls === undefined ? null : (
                      <details className="raw">
                        <summary>toolCalls</summary>
                        <pre className="json">{JSON.stringify(message.toolCalls, null, 2)}</pre>
                      </details>
                    )}
                    {message.metadata === undefined ? null : (
                      <details className="raw">
                        <summary>metadata</summary>
                        <pre className="json">{JSON.stringify(message.metadata, null, 2)}</pre>
                      </details>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </section>

      <ProbeDialog
        open={probeOpen}
        {...(target === undefined ? {} : { target })}
        {...(data.probe === undefined ? {} : { probe: data.probe })}
        {...(data.probeError === undefined ? {} : { error: data.probeError })}
        {...(data.busy === undefined ? {} : { busy: true })}
        onAsk={(question) => onAsk(question)}
        onClose={() => setProbeOpen(false)}
      />

      <CompactDialog
        open={compactOpen}
        {...(target === undefined ? {} : { target })}
        onClose={() => setCompactOpen(false)}
        onCompact={(choice) => {
          setCompactOpen(false);
          onCompact(choice === "all" ? "all" : "current");
        }}
      />
    </main>
  );
}
