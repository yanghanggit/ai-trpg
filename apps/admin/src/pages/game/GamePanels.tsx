import { useState } from "react";
import GamePageLinks from "../../components/GamePageLinks";
import Hint from "../../components/Hint";
import PageHeader from "../../components/PageHeader";
import { advanceReadings } from "./advanceReadings";
import DangerDialog from "./DangerDialog";
import { actorStageId } from "./graph/flow";
import StageExplorer, { type ExplorerTarget } from "./graph/StageExplorer";
import WorldCard from "./graph/WorldCard";
import LeaksDialog from "./LeaksDialog";
import NewMessagesDialog from "./NewMessagesDialog";
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
    <main className="admin admin--console">
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

      {/* 图谱在左、推进在右：图谱要的是面积，推进要的是顺手。 */}
      <div className="console-grid">
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
          unseen={data.unseen}
          actions={actions}
          onOpenActor={(actorId) => {
            const stageId =
              data.graph === undefined ? undefined : actorStageId(data.graph, actorId);
            if (stageId !== undefined) {
              setExplorer({ stageId, actorId });
            }
          }}
        />
      </div>
      <LeaksDialog
        open={data.leaksOpen}
        result={data.leaks}
        scanning={data.leaksOpen && data.leaks === undefined && data.leaksError === undefined}
        onRescan={() => actions.rescanLeaks()}
        onClose={() => actions.closeLeaks()}
        {...(data.leaksError === undefined ? {} : { error: data.leaksError })}
      />
      {data.feedOpen ? (
        <NewMessagesDialog
          slug={data.slug}
          latestCursor={data.latestCursor}
          order="asc"
          onClose={() => actions.closeFeed()}
        />
      ) : null}
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

type AdvanceSectionProps = {
  busy: boolean;
  graph?: GamePageData["graph"];
  steps: GamePageData["advanceSteps"];
  unseen: number;
  actions: GamePageActions;
  /** 点表里的角色：落到他的舞台页，看这个人现在的样子。 */
  onOpenActor: (actorId: string) => void;
};

/**
 * 推进：一次点击走一步，步与步之间的判断全在按钮背后。
 *
 * 服务器只拥有四层单层入口与顺位/回合账的两份读数，次序在客户端。这里把次序摆成一张
 * 编排表——名次、角色、他所在的舞台、这一轮过了没有——按钮只有一个：按游戏设计往下走。
 */
function AdvanceSection({ busy, graph, steps, unseen, actions, onOpenActor }: AdvanceSectionProps) {
  const readings = advanceReadings(graph, graph?.round);
  const { hasOrder, rows, worldPushed, roundDone, roundClosed, blocked, nextStep, worldName } =
    readings;

  return (
    <section className="panel panel--advance">
      <h2>
        推进
        <Hint text="一次点击走一步：没有顺位就先开一条，顺位上没人了就收工；这一轮活人已齐平而 world 还没推，就先补 world；否则推下一位角色，再推他所在的舞台。每一步都重新读顺位与回合账，不拿面板上那份旧图做决定。玩家席位不替人决定，遇到它会停下。「新事件」只读上次看过之后新增的那几条——水位记在这个浏览器里，所以它数的是「你错过的」，不是「这一局有多少」。" />
      </h2>

      {hasOrder ? null : (
        <p className="muted">没有进行中的顺位。点「下一个」会开一条（名次按敏捷现值排）。</p>
      )}

      {hasOrder ? (
        <table className="orchestration">
          <thead>
            <tr>
              <th>#</th>
              <th>角色</th>
              <th>舞台</th>
              <th>本轮</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.actorId} className={row.isNext ? "orchestration__row--next" : undefined}>
                <td className="orchestration__pos">{row.position}</td>
                <td>
                  <button
                    type="button"
                    className={row.alive ? "linkish" : "linkish muted"}
                    onClick={() => onOpenActor(row.actorId)}
                  >
                    {row.actorName}
                  </button>
                  <span className="orchestration__control">
                    {row.control === "player" ? "玩家" : "NPC"}
                  </span>
                </td>
                <td className="muted">{row.stageName ?? "—"}</td>
                <td>
                  {row.actedThisRound ? (
                    <span className={row.emptyThisRound ? "badge" : "badge badge--ok"}>
                      {row.emptyThisRound ? "空过" : "✓"}
                    </span>
                  ) : row.isNext ? (
                    <span className="badge badge--pending">下一个</span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
            <tr className={roundDone && !worldPushed ? "orchestration__row--next" : undefined}>
              <td className="orchestration__pos">—</td>
              <td colSpan={2}>
                world 回合
                {worldName === undefined ? null : <span className="muted"> · {worldName}</span>}
              </td>
              <td>
                {worldPushed ? (
                  <span className="badge badge--ok">✓</span>
                ) : roundDone ? (
                  <span className="badge badge--pending">该推</span>
                ) : (
                  <span className="muted">齐平后</span>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      ) : null}

      <div className="row">
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => void actions.next()}
        >
          下一个
        </button>
        <button
          type="button"
          className="button button--ghost"
          disabled={busy}
          onClick={() => actions.openFeed()}
        >
          新事件{unseen > 0 ? ` · ${unseen}` : ""}
        </button>
        <span className="muted">
          第 {readings.roundIndex} 轮 · 下一个：{nextStep}
          {roundClosed ? "（这一轮已收尾，下一步开始下一轮）" : ""}
          {blocked === undefined ? "" : ` · ${blocked}`}
        </span>
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
    </section>
  );
}
