import type { GameView } from "../../../features/games/useGameView";

/**
 * 「舞台」浮窗：环境原文。
 *
 * 这段文字是写给模型看的上下文，主页不铺它；客户端将来会用文生图表达，
 * 现在先按原样给人读。
 */
export default function StagePanel({ view }: { view: GameView }) {
  const { stage } = view;

  return (
    <>
      <p className="prose">{stage.environment}</p>
      <p className="muted">
        锚点 {stage.anchors.length} · 出口 {stage.exits.length} · 在场 {stage.actors.length}
      </p>
    </>
  );
}
