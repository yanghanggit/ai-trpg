import { useState } from "react";
import GamePageLinks from "../../components/GamePageLinks";
import Hint from "../../components/Hint";
import PageHeader from "../../components/PageHeader";
import type { AdvanceKind } from "../../features/games/useGameActions";
import { advanceReadings } from "./advanceReadings";
import DangerDialog from "./DangerDialog";
import StageExplorer, { type ExplorerTarget } from "./graph/StageExplorer";
import WorldCard from "./graph/WorldCard";
import LeaksDialog from "./LeaksDialog";
import type { GamePageActions, GamePageData } from "./types";

type Props = {
  data: GamePageData;
  actions: GamePageActions;
};

/**
 * 局控制台的展示层：只读 `data`、只调 `actions`。
 *
 * 危险操作在这里要一次确认——确认是交互，不是判定；写成没写成仍然由服务端说了算。
 */
export default function GamePanels({ data, actions }: Props) {
  const [dangerOpen, setDangerOpen] = useState(false);
  // 图谱钻取是这一页的临时视图，不当成路由：关掉就回到控制台原样。
  const [explorer, setExplorer] = useState<ExplorerTarget>();

  return (
    <main className="admin">
      <PageHeader
        crumbs={[
          { label: "总览", to: "/" },
          { label: "局", to: "/games" },
          { label: data.slug, to: `/g/${encodeURIComponent(data.slug)}` },
        ]}
        nav={<GamePageLinks slug={data.slug} current="console" />}
        title={<code>{data.slug}</code>}
        onRefresh={() => void actions.refresh()}
        danger={
          <button
            type="button"
            className="button button--danger"
            onClick={() => setDangerOpen(true)}
          >
            危险操作
          </button>
        }
      >
        {data.busy === undefined ? null : <span className="badge badge--pending">{data.busy}</span>}
        <button type="button" className="button button--ghost" onClick={() => actions.openLeaks()}>
          真名扫描
        </button>
      </PageHeader>

      {data.actionError === undefined ? null : <p className="form-error">{data.actionError}</p>}
      {data.advanceNote === undefined ? null : <p className="muted">{data.advanceNote}</p>}

      <WorldCard
        {...(data.graph === undefined ? {} : { graph: data.graph })}
        {...(data.graphError === undefined ? {} : { error: data.graphError })}
        onOpen={(stageId, actorId) =>
          setExplorer(actorId === undefined ? { stageId } : { stageId, actorId })
        }
      />
      <AdvanceSection
        busy={data.busy !== undefined}
        graph={data.graph}
        steps={data.advanceSteps}
        actions={actions}
      />
      <LeaksDialog
        open={data.leaksOpen}
        result={data.leaks}
        scanning={data.leaksOpen && data.leaks === undefined && data.leaksError === undefined}
        onRescan={() => actions.rescanLeaks()}
        onClose={() => actions.closeLeaks()}
        {...(data.leaksError === undefined ? {} : { error: data.leaksError })}
      />
      <StageExplorer
        {...(data.graph === undefined ? {} : { graph: data.graph })}
        {...(explorer === undefined ? {} : { target: explorer })}
        onNavigate={setExplorer}
      />
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

type AdvanceSectionProps = {
  busy: boolean;
  graph?: GamePageData["graph"];
  steps: GamePageData["advanceSteps"];
  actions: GamePageActions;
};

/**
 * 推进：手动挡的同一次编排。
 *
 * 服务器只拥有四层单层入口与顺位快照，次序在客户端。这里把「下一步是什么」摆成读数，
 * 主按钮一次跑完一小步（npc → 该角色所在舞台 → 齐平时 world），单步按钮留作修理。
 */
function AdvanceSection({ busy, graph, steps, actions }: AdvanceSectionProps) {
  const [kind, setKind] = useState<AdvanceKind>("npc");
  const [target, setTarget] = useState("");
  const [version, setVersion] = useState("");

  const { hasOrder, next, counts, complete, nextStage, chainAllowed } = advanceReadings(graph);

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

  return (
    <section className="panel">
      <h2>
        推进
        <Hint text="一次点击只推进一个回合，作业落账后才有结果。串行编排（npc → 该角色所在舞台 → 齐平时 world）由「推进一步」一次跑完；链中途失败就按单步补完。玩家席位不替人决定，遇到它会停下。expectedVersion 默认取顺位读到的那份版本，手填只在指定推进里。" />
      </h2>

      {hasOrder ? null : <p className="muted">没有进行中的顺位：先开一条，才有「下一位」可推。</p>}
      {hasOrder ? (
        <dl className="facts facts--page">
          <div>
            <dt>下一位</dt>
            <dd>
              {next === null
                ? "没有活着的了"
                : `${next.position} ${next.actorName}（${next.player ? "玩家" : "NPC"}）`}
            </dd>
          </div>
          <div>
            <dt>本轮</dt>
            <dd>
              {counts.length === 0 ? "—" : counts.join(" / ")}
              {" · "}
              {complete ? "已齐平" : "未齐平"}
            </dd>
          </div>
          <div>
            <dt>下一步</dt>
            <dd>
              {next === null
                ? "收工"
                : `${next.player ? "等玩家动手" : `NPC ${next.actorName}`} → 舞台 ${
                    nextStage ?? "（认不出）"
                  } → ${complete ? "world 回合" : "齐平后才是 world"}`}
            </dd>
          </div>
        </dl>
      ) : null}

      {complete && chainAllowed ? (
        <p className="muted">
          本轮活人已推齐：如果这一轮的 world 还没跑，先按「只推 world」——「推进一步」会从下一位
          开始，等于跳过它。
        </p>
      ) : null}

      <div className="row">
        <button
          type="button"
          className="button"
          disabled={busy || !chainAllowed}
          onClick={() => void actions.advanceChain()}
        >
          推进一步
        </button>
        <button
          type="button"
          className="button button--ghost"
          disabled={busy || !chainAllowed}
          onClick={() => void actions.advanceOne("npc")}
        >
          只推这位 NPC
        </button>
        <button
          type="button"
          className="button button--ghost"
          disabled={busy || nextStage === undefined}
          onClick={() => void actions.advanceOne("stage")}
        >
          只推舞台{nextStage === undefined ? "" : `：${nextStage}`}
        </button>
        <button
          type="button"
          className="button button--ghost"
          disabled={busy}
          onClick={() => void actions.advanceOne("world")}
        >
          只推 world
        </button>
        {hasOrder ? (
          <button
            type="button"
            className="button button--ghost"
            disabled={busy}
            onClick={() => void actions.completeOrder()}
          >
            收工
          </button>
        ) : (
          <button
            type="button"
            className="button button--ghost"
            disabled={busy}
            onClick={() => void actions.openOrder()}
          >
            开一条顺位
          </button>
        )}
      </div>

      {steps.length === 0 ? null : (
        <ol className="steps">
          {steps.map((step) => (
            <li key={step.jobId} className="steps__row">
              <span className="steps__label">{step.label}</span>
              <code className="steps__id">{step.jobId.slice(0, 8)}</code>
              <span className={step.status === "failed" ? "badge badge--error" : "badge"}>
                {step.status}
              </span>
              {step.detail === undefined ? null : (
                <span className="muted steps__detail">{step.detail}</span>
              )}
            </li>
          ))}
        </ol>
      )}

      <details className="raw">
        <summary>指定推进（绕过编排，只下一层）</summary>
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
            <span>expectedVersion（留空不比版本）</span>
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
      </details>
    </section>
  );
}
