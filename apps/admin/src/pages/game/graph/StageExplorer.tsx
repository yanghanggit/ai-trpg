import { useMemo, useState } from "react";
import Dialog from "../../../components/Dialog";
import type { GameGraph } from "../../../features/games/useGameGraph";
import ActorInspector from "./ActorInspector";
import FlowCanvas from "./FlowCanvas";
import { stageFlow } from "./flow";
import ItemDialog from "./ItemDialog";
import StagePanel from "./StagePanel";
import { stageView } from "./viewModel";

export type ExplorerTarget = { stageId: string; actorId?: string };

type Props = {
  graph?: GameGraph;
  /** `undefined` 就是关着；打开时落在哪个舞台、是否直接看某个人。 */
  target?: ExplorerTarget;
  onNavigate: (target: ExplorerTarget | undefined) => void;
};

/**
 * 第二层与第三层：舞台为根，actor 按顺位排；点人看它身上带着什么。
 *
 * 四层都在同一个弹窗里下钻（世界 → 舞台 → actor → 道具），面包屑就是回路：
 * 点「世界图谱」回卡片，点舞台回舞台，Esc 逐级退——不为一次排查多开三个页面。
 */
export default function StageExplorer({ graph, target, onNavigate }: Props) {
  const [item, setItem] = useState<Record<string, unknown>>();

  const stageId = target?.stageId;
  const flow = useMemo(
    () =>
      graph === undefined || stageId === undefined
        ? { nodes: [], edges: [] }
        : stageFlow(graph, stageId),
    [graph, stageId],
  );
  const view = useMemo(
    () => (graph === undefined || stageId === undefined ? undefined : stageView(graph, stageId)),
    [graph, stageId],
  );

  const actor =
    graph === undefined || target?.actorId === undefined
      ? undefined
      : graph.actors.find((candidate) => candidate.id === target.actorId);
  const entry = view?.actors.find((row) => row.actor.id === target?.actorId)?.entry;

  function go(next: ExplorerTarget | undefined) {
    setItem(undefined);
    onNavigate(next);
  }

  const title =
    view === undefined ? (
      "世界图谱"
    ) : (
      <span className="crumbs">
        <button type="button" className="crumbs__link" onClick={() => go(undefined)}>
          世界图谱
        </button>
        <span className="crumbs__sep">/</span>
        {actor === undefined ? (
          <span className="crumbs__here">{view.stage.name}</span>
        ) : (
          <button
            type="button"
            className="crumbs__link"
            onClick={() => go({ stageId: view.stage.id })}
          >
            {view.stage.name}
          </button>
        )}
        {actor === undefined ? null : (
          <>
            <span className="crumbs__sep">/</span>
            <span className="crumbs__here">{actor.name}</span>
          </>
        )}
      </span>
    );

  return (
    <>
      <Dialog
        wide
        open={target !== undefined}
        title={title}
        onCancel={() => {
          if (target?.actorId !== undefined) {
            go({ stageId: target.stageId });
            return;
          }
          go(undefined);
        }}
        onClose={() => go(undefined)}
      >
        {view === undefined ? (
          <p className="muted">这个舞台已经不在图上了：刷新后再看。</p>
        ) : (
          <div className="explorer">
            <FlowCanvas
              className="graph-canvas graph-canvas--explorer"
              nodes={flow.nodes}
              edges={flow.edges}
              draggable
              onStageClick={(next) => go({ stageId: next })}
              onActorClick={(actorId) => go({ stageId: view.stage.id, actorId })}
            />
            {actor === undefined ? (
              graph === undefined ? null : (
                <StagePanel
                  graph={graph}
                  view={view}
                  onItemClick={(next) => setItem(next)}
                  onSelectStage={(next) => go({ stageId: next })}
                />
              )
            ) : (
              <ActorInspector
                actor={actor}
                {...(entry === undefined ? {} : { entry })}
                onItemClick={(next) => setItem(next)}
              />
            )}
          </div>
        )}
      </Dialog>

      <ItemDialog item={item} onClose={() => setItem(undefined)} />
    </>
  );
}
