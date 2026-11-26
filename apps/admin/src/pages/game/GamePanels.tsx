import { useState } from "react";
import { Link } from "react-router";
import type { AdvanceKind } from "../../features/games/useGameActions";
import type { JobView, MemoryOwner } from "../../features/games/useGameData";
import { formatAt } from "../../lib/format";
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
  return (
    <main className="admin">
      <header className="admin__bar">
        <div>
          <p className="eyebrow">
            <Link to="/">总览</Link> / 局控制台
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
            onClick={() => void actions.refresh()}
          >
            重读
          </button>
        </div>
      </header>

      {data.actionError === undefined ? null : <p className="form-error">{data.actionError}</p>}

      <JobsSection data={data} actions={actions} />
      <AdvanceSection busy={data.busy !== undefined} actions={actions} />
      <StateSection data={data} />
      <TraceSection data={data} actions={actions} />
      <MessagesSection data={data} />
      <AuxSection data={data} actions={actions} />
      <DangerSection data={data} actions={actions} />
    </main>
  );
}

function JobsSection({ data, actions }: Props) {
  const jobs = data.jobs ?? [];
  const active = jobs.filter((job) => job.status === "pending" || job.status === "running");

  function handleCancel(job: JobView) {
    if (window.confirm(`取消作业 ${job.jobId}？排队中的当场撤，执行中的在下一个检查点停。`)) {
      void actions.cancelJob(job.jobId);
    }
  }

  return (
    <section className="panel">
      <h2>作业</h2>
      <p className="muted">
        {active.length === 0
          ? "这一局现在没有在跑的回合。"
          : `${active.length} 个回合在排队或执行中。`}
      </p>

      {data.watchedJob === undefined ? null : (
        <dl className="facts">
          <div>
            <dt>刚入队的作业</dt>
            <dd>
              <code>{data.watchedJob.jobId.slice(0, 8)}</code>
            </dd>
          </div>
          <div>
            <dt>状态</dt>
            <dd className={statusClass(data.watchedJob.status)}>{data.watchedJob.status}</dd>
          </div>
          <div>
            <dt>步骤</dt>
            <dd>{data.watchedJob.progress?.step ?? "—"}</dd>
          </div>
          <div>
            <dt>结果</dt>
            <dd>
              {data.watchedJob.result === null
                ? "—"
                : data.watchedJob.result.ok
                  ? "ok"
                  : (data.watchedJob.errorCode ?? "failed")}
            </dd>
          </div>
        </dl>
      )}

      {data.jobs === undefined ? (
        <p className="muted">{data.jobsError ?? "读取中…"}</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>作业</th>
              <th>类型</th>
              <th>状态</th>
              <th>步骤 / 错误</th>
              <th>更新时间</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.jobId}>
                <td>
                  <code>{job.jobId.slice(0, 8)}</code>
                </td>
                <td>{job.kind}</td>
                <td className={statusClass(job.status)}>
                  {job.status}
                  {job.cancelRequested && job.status === "running" ? "（待撤）" : ""}
                </td>
                <td>
                  {job.error === null
                    ? (job.progress?.step ?? "—")
                    : `${job.errorCode}: ${job.error}`}
                </td>
                <td>{formatAt(job.updatedAt)}</td>
                <td>
                  {job.status === "pending" || job.status === "running" ? (
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => handleCancel(job)}
                    >
                      取消
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
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
      <h2>推进</h2>
      <p className="muted">
        world 能结束一局，stage 只写环境，npc 只推进一个 actor。入队立刻返回作业
        id，结果看重读的终态。
      </p>

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

function StateSection({ data }: { data: GamePageData }) {
  return (
    <section className="panel">
      <h2>活状态</h2>
      <p className="muted">上帝视角的全量投影；形状仍是不透明的 `unknown`，这里只原样展开。</p>
      {data.state === undefined ? (
        <p className="muted">{data.stateError ?? "读取中…"}</p>
      ) : (
        <details className="details">
          <summary>展开原始 JSON</summary>
          <pre className="json">{JSON.stringify(data.state, null, 2)}</pre>
        </details>
      )}
    </section>
  );
}

function TraceSection({ data, actions }: { data: GamePageData; actions: GamePageActions }) {
  return (
    <section className="panel">
      <h2>轨迹</h2>
      <p className="muted">文件语料，不是数据库；这里读的是本局最近的回合。</p>
      {data.turns === undefined ? (
        <p className="muted">{data.turnsError ?? "读取中…"}</p>
      ) : data.turns.length === 0 ? (
        <p className="muted">还没有轨迹。</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>回合</th>
              <th>类型</th>
              <th>目标</th>
              <th>结果</th>
              <th>模型</th>
              <th>开始</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.turns.map((turn) => (
              <tr key={turn.turnId}>
                <td>
                  <code>{turn.turnId.slice(0, 8)}</code>
                </td>
                <td>{turn.turnKind}</td>
                <td>{turn.actorName ?? turn.stageName ?? "—"}</td>
                <td>
                  {turn.ok === undefined ? "—" : turn.ok ? "ok" : (turn.rejected ?? "failed")}
                </td>
                <td>
                  {turn.llmCalls}
                  {turn.llmErrors > 0 ? `（错 ${turn.llmErrors}）` : ""}
                </td>
                <td>{formatAt(turn.startedAt)}</td>
                <td>
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() =>
                      actions.selectTurn(
                        data.selectedTurnId === turn.turnId ? undefined : turn.turnId,
                      )
                    }
                  >
                    {data.selectedTurnId === turn.turnId ? "收起" : "事件"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {data.selectedTurnId === undefined ? null : (
        <details className="details" open>
          <summary>回合 {data.selectedTurnId.slice(0, 8)} 的事件</summary>
          <pre className="json">
            {data.turnEvents === undefined ? "读取中…" : JSON.stringify(data.turnEvents, null, 2)}
          </pre>
        </details>
      )}
    </section>
  );
}

function MessagesSection({ data }: { data: GamePageData }) {
  return (
    <section className="panel">
      <h2>事件流</h2>
      <p className="muted">公共事件流（`game_messages`）：上帝视角、带真实名字，只追加。</p>
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
      <h2>只读旁路</h2>
      <p className="muted">都只读：记忆、真名扫描、探针。跑它们不改状态，也不写事件。</p>

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

function DangerSection({ data, actions }: { data: GamePageData; actions: GamePageActions }) {
  const [outcome, setOutcome] = useState("");
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState("");

  const canEnd = outcome.trim().length > 0;
  const canDelete = confirmation.trim() === data.slug;

  return (
    <section className="panel panel--danger">
      <h2>危险操作</h2>

      <h3>结束一局</h3>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canEnd) {
            return;
          }
          if (!window.confirm(`结束「${data.slug}」？结局标签：${outcome.trim()}`)) {
            return;
          }
          void actions.endGame({
            outcome: outcome.trim(),
            ...(message.trim() === "" ? {} : { message: message.trim() }),
          });
        }}
      >
        <label className="field">
          <span>结局标签</span>
          <input
            value={outcome}
            onChange={(event) => setOutcome(event.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="field">
          <span>正文（可选）</span>
          <input
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            autoComplete="off"
          />
        </label>
        <button className="button button--danger" type="submit" disabled={!canEnd}>
          结束
        </button>
      </form>

      <h3>删除一局</h3>
      <p className="muted">级联清场，不可恢复。输入 slug 确认。</p>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canDelete) {
            return;
          }
          if (window.confirm(`删除「${data.slug}」及其全部数据？不可恢复。`)) {
            void actions.deleteGame();
          }
        }}
      >
        <label className="field">
          <span>确认 slug</span>
          <input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder={data.slug}
            autoComplete="off"
          />
        </label>
        <button className="button button--danger" type="submit" disabled={!canDelete}>
          删除
        </button>
      </form>
    </section>
  );
}

function statusClass(status: JobView["status"]): string {
  if (status === "succeeded") {
    return "badge badge--ok";
  }
  if (status === "failed") {
    return "badge badge--error";
  }
  if (status === "canceled") {
    return "badge badge--muted";
  }
  return "badge badge--pending";
}
