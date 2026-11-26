import { useState } from "react";
import { Link } from "react-router";
import Hint from "../../components/Hint";
import type { AdvanceKind } from "../../features/games/useGameActions";
import { AUTO_REFRESH_INTERVAL_MS, type MemoryOwner } from "../../features/games/useGameData";
import { formatAt } from "../../lib/format";
import DangerDialog from "./DangerDialog";
import type { GamePageActions, GamePageData } from "./types";

type Props = {
  data: GamePageData;
  actions: GamePageActions;
};

/**
 * 局控制台的展示层：只读 `data`、只调 `actions`。
 *
 * 危险操作在这里要一次确认——确认是交互，不是判定；作业算不算成功仍然由容器重读终态决定。
 */
export default function GamePanels({ data, actions }: Props) {
  const [dangerOpen, setDangerOpen] = useState(false);

  return (
    <main className="admin">
      <header className="admin__bar">
        <div>
          <p className="eyebrow">
            <Link to="/">总览</Link> / <Link to="/games">局</Link> / 局控制台
          </p>
          <h1>
            <code>{data.slug}</code>
          </h1>
        </div>
        <div className="admin__actions">
          {data.busy === undefined ? null : (
            <span className="badge badge--pending">{data.busy}</span>
          )}
          <button
            type="button"
            className="button button--ghost"
            aria-pressed={data.autoRefresh}
            title={`每 ${AUTO_REFRESH_INTERVAL_MS / 1000} 秒重读一次事件流`}
            onClick={() => actions.toggleAutoRefresh()}
          >
            自动刷新：{data.autoRefresh ? "开" : "关"}
          </button>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => void actions.refresh()}
          >
            刷新
          </button>
          <button
            type="button"
            className="button button--danger"
            onClick={() => setDangerOpen(true)}
          >
            危险操作
          </button>
        </div>
      </header>

      {data.actionError === undefined ? null : <p className="form-error">{data.actionError}</p>}
      {data.queuedJobId === undefined ? null : (
        <p className="muted">
          已入队 <code>{data.queuedJobId.slice(0, 8)}</code>：结果看下面的事件流。
        </p>
      )}

      <AdvanceSection busy={data.busy !== undefined} actions={actions} />
      <MessagesSection data={data} />
      <AuxSection data={data} actions={actions} />
      <DangerDialog
        slug={data.slug}
        open={dangerOpen}
        onClose={() => setDangerOpen(false)}
        actions={actions}
      />
    </main>
  );
}

const ADVANCE_LABELS: Record<AdvanceKind, { label: string; target: string; placeholder: string }> =
  {
    npc: { label: "NPC 回合", target: "actor 名", placeholder: "例：神父" },
    stage: { label: "舞台回合", target: "stage 名或 id", placeholder: "例：钟楼" },
    world: { label: "world 回合", target: "（不需要）", placeholder: "" },
  };

function AdvanceSection({ busy, actions }: { busy: boolean; actions: GamePageActions }) {
  const [kind, setKind] = useState<AdvanceKind>("npc");
  const [target, setTarget] = useState("");
  const [version, setVersion] = useState("");
  const [actors, setActors] = useState("");

  const needsTarget = kind !== "world";
  const canSubmit = !needsTarget || target.trim().length > 0;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    const parsedVersion = version.trim() === "" ? undefined : Number(version.trim());
    void actions.advance({
      kind,
      ...(needsTarget ? { target: target.trim() } : {}),
      ...(parsedVersion === undefined || Number.isNaN(parsedVersion)
        ? {}
        : { expectedVersion: parsedVersion }),
    });
  }

  function handlePass(event: React.FormEvent) {
    event.preventDefault();
    const names = actors
      .split(/[,，\s]+/)
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    if (names.length === 0) {
      return;
    }
    void actions.pass(names);
  }

  return (
    <section className="panel">
      <h2>
        推进
        <Hint text="world 能结束一局，stage 只写环境，npc 只推进一个 actor。入队立刻返回作业 id，结果只看重读的终态。" />
      </h2>

      <form className="inline-form" onSubmit={handleSubmit}>
        <label className="field">
          <span>层</span>
          <select value={kind} onChange={(event) => setKind(event.target.value as AdvanceKind)}>
            {(Object.keys(ADVANCE_LABELS) as AdvanceKind[]).map((value) => (
              <option key={value} value={value}>
                {ADVANCE_LABELS[value].label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{ADVANCE_LABELS[kind].target}</span>
          <input
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            placeholder={ADVANCE_LABELS[kind].placeholder}
            disabled={!needsTarget}
            autoComplete="off"
          />
        </label>
        <label className="field">
          <span>expectedVersion（可选）</span>
          <input
            value={version}
            onChange={(event) => setVersion(event.target.value)}
            placeholder="留空则不比版本"
            inputMode="numeric"
            autoComplete="off"
          />
        </label>
        <button className="button" type="submit" disabled={busy || !canSubmit}>
          入队
        </button>
      </form>

      <h3>空过</h3>
      <form className="inline-form" onSubmit={handlePass}>
        <label className="field">
          <span>actor 名单（逗号或空格分隔）</span>
          <input
            value={actors}
            onChange={(event) => setActors(event.target.value)}
            placeholder="例：神父, 修士"
            autoComplete="off"
          />
        </label>
        <button className="button button--ghost" type="submit" disabled={busy}>
          记空回合
        </button>
      </form>
    </section>
  );
}

function MessagesSection({ data }: { data: GamePageData }) {
  return (
    <section className="panel">
      <h2>
        事件流
        <Hint text="公共事件流（game_messages）：上帝视角、带真实名字，只追加。" />
      </h2>
      {data.messages === undefined ? (
        <p className="muted">{data.messagesError ?? "读取中…"}</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>类型</th>
              <th>可见性</th>
              <th>内容</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            {data.messages.map((message) => (
              <tr key={message.id}>
                <td>{message.sequence}</td>
                <td>{message.kind}</td>
                <td>{message.visibility}</td>
                <td>{message.content}</td>
                <td>{formatAt(message.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function AuxSection({ data, actions }: { data: GamePageData; actions: GamePageActions }) {
  const [owner, setOwner] = useState<MemoryOwner>("actor");
  const [name, setName] = useState("");
  const [question, setQuestion] = useState("");
  const [askName, setAskName] = useState("");
  const [compactOwner, setCompactOwner] = useState<MemoryOwner | "all">("all");

  return (
    <section className="panel">
      <h2>
        只读旁路
        <Hint text="记忆、真名扫描、探针都只读：跑它们不改状态，也不写事件。" />
      </h2>

      <h3>记忆</h3>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          actions.loadMemory({ owner, ...(name.trim() === "" ? {} : { name: name.trim() }) });
        }}
      >
        <label className="field">
          <span>owner</span>
          <select value={owner} onChange={(event) => setOwner(event.target.value as MemoryOwner)}>
            <option value="actor">actor</option>
            <option value="stage">stage</option>
            <option value="world">world</option>
          </select>
        </label>
        <label className="field">
          <span>名字（可选）</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
          />
        </label>
        <button className="button button--ghost" type="submit">
          读取
        </button>
      </form>
      {data.memory === undefined ? (
        data.memoryError === undefined ? null : (
          <p className="form-error">{data.memoryError}</p>
        )
      ) : (
        <details className="details">
          <summary>
            记忆原文（{data.memory.query.owner}
            {data.memory.query.name === undefined ? "" : ` · ${data.memory.query.name}`}）
          </summary>
          <pre className="json">{JSON.stringify(data.memory.payload, null, 2)}</pre>
        </details>
      )}

      <h3>真名泄漏扫描</h3>
      <button type="button" className="button button--ghost" onClick={() => actions.loadLeaks()}>
        扫描
      </button>
      {data.leaks === undefined ? null : (
        <details className="details" open>
          <summary>扫描结果</summary>
          <pre className="json">{JSON.stringify(data.leaks, null, 2)}</pre>
        </details>
      )}

      <h3>探针</h3>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (question.trim().length === 0) {
            return;
          }
          void actions.probe({
            message: question.trim(),
            ...(askName.trim() === "" ? {} : { actor: askName.trim() }),
          });
        }}
      >
        <label className="field">
          <span>问题</span>
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="只凭 prompt 与 memory 回答"
            autoComplete="off"
          />
        </label>
        <label className="field">
          <span>actor（可选）</span>
          <input
            value={askName}
            onChange={(event) => setAskName(event.target.value)}
            autoComplete="off"
          />
        </label>
        <button
          className="button button--ghost"
          type="submit"
          disabled={question.trim().length === 0}
        >
          提问
        </button>
      </form>
      {data.probeResult === undefined ? null : (
        <details className="details" open>
          <summary>探针答复</summary>
          <pre className="json">{JSON.stringify(data.probeResult, null, 2)}</pre>
        </details>
      )}

      <h3>产物</h3>
      <div className="inline-form">
        <button
          type="button"
          className="button button--ghost"
          onClick={() => void actions.snapshot()}
        >
          落快照
        </button>
        <button type="button" className="button button--ghost" onClick={() => void actions.story()}>
          故事总结
        </button>
      </div>
      {data.auxResult === undefined ? null : (
        <details className="details" open>
          <summary>{data.auxResult.title}</summary>
          <pre className="json">{JSON.stringify(data.auxResult.payload, null, 2)}</pre>
        </details>
      )}

      <h3>压缩记忆</h3>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (window.confirm(`压缩 ${compactOwner} 的记忆？`)) {
            void actions.compact({ owner: compactOwner });
          }
        }}
      >
        <label className="field">
          <span>owner</span>
          <select
            value={compactOwner}
            onChange={(event) => setCompactOwner(event.target.value as MemoryOwner | "all")}
          >
            <option value="all">all</option>
            <option value="actor">actor</option>
            <option value="stage">stage</option>
            <option value="world">world</option>
          </select>
        </label>
        <button className="button button--ghost" type="submit">
          压缩
        </button>
      </form>
    </section>
  );
}
